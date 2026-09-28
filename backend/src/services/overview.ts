import { and, arrayOverlaps, count, desc, eq, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { checkResults, driftEvents, incidents, monitors } from '../db/schema.js';
import type { Ctx } from './context.js';
import { getMonitorRow } from './monitors.js';

export async function summary(ctx: Ctx) {
  const byStatus = await ctx.db
    .select({ status: monitors.status, enabled: monitors.enabled, n: count() })
    .from(monitors)
    .groupBy(monitors.status, monitors.enabled);
  const counts = { total: 0, up: 0, down: 0, unknown: 0, paused: 0 };
  for (const r of byStatus) {
    counts.total += r.n;
    if (!r.enabled) counts.paused += r.n;
    else counts[r.status] += r.n;
  }
  const driftBySeverity = await ctx.db
    .select({ severity: driftEvents.severity, n: count() })
    .from(driftEvents)
    .where(eq(driftEvents.status, 'open'))
    .groupBy(driftEvents.severity);
  const openDrift = { breaking: 0, warning: 0, info: 0 };
  for (const r of driftBySeverity) openDrift[r.severity] = r.n;
  const [openIncidents] = await ctx.db.select({ n: count() }).from(incidents).where(isNull(incidents.resolvedAt));
  const [checks24h] = await ctx.db
    .select({ n: count(), failed: sql<number>`count(*) filter (where not ${checkResults.ok})::int` })
    .from(checkResults)
    .where(sql`${checkResults.startedAt} > now() - interval '24 hours'`);
  return {
    monitors: counts,
    openIncidents: openIncidents?.n ?? 0,
    openDrift,
    checksLast24h: { total: checks24h?.n ?? 0, failed: Number(checks24h?.failed ?? 0) },
  };
}

export async function listIncidents(
  ctx: Ctx,
  f: { status?: 'open' | 'resolved' | undefined; monitorId?: string | undefined; limit: number },
) {
  const where: SQL[] = [];
  if (f.status === 'open') where.push(isNull(incidents.resolvedAt));
  if (f.status === 'resolved') where.push(isNotNull(incidents.resolvedAt));
  if (f.monitorId) where.push(eq(incidents.monitorId, f.monitorId));
  return ctx.db
    .select({
      id: incidents.id,
      monitorId: incidents.monitorId,
      monitorName: monitors.name,
      openedAt: incidents.openedAt,
      resolvedAt: incidents.resolvedAt,
      cause: incidents.cause,
      lastError: incidents.lastError,
      failureCount: incidents.failureCount,
    })
    .from(incidents)
    .innerJoin(monitors, eq(monitors.id, incidents.monitorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(incidents.openedAt))
    .limit(f.limit);
}

export async function listResults(ctx: Ctx, monitorId: string, f: { limit: number; before?: number | undefined }) {
  await getMonitorRow(ctx, monitorId);
  return ctx.db
    .select()
    .from(checkResults)
    .where(and(eq(checkResults.monitorId, monitorId), f.before ? lt(checkResults.id, f.before) : undefined))
    .orderBy(desc(checkResults.id))
    .limit(f.limit);
}

export type GateFailOn = 'down' | 'unknown' | 'breaking' | 'warning';

/**
 * CI deploy gate. Evaluates enabled monitors (optionally filtered by tags) and fails when any is
 * down / unknown, or has open drift at or above the requested severity.
 */
export async function evaluateGate(ctx: Ctx, opts: { tags: string[]; failOn: GateFailOn[] }) {
  const where: SQL[] = [eq(monitors.enabled, true)];
  if (opts.tags.length)
    where.push(
      arrayOverlaps(
        monitors.tags,
        opts.tags.map((t) => t.toLowerCase()),
      ),
    );
  const rows = await ctx.db
    .select({
      id: monitors.id,
      name: monitors.name,
      status: monitors.status,
      tags: monitors.tags,
      // Qualified explicitly: Drizzle renders column refs unqualified in select expressions, which
      // would bind to drift_events.id inside the correlated subquery.
      breaking: sql<number>`(select count(*)::int from drift_events d where d.monitor_id = "monitors"."id" and d.status = 'open' and d.severity = 'breaking')`,
      warning: sql<number>`(select count(*)::int from drift_events d where d.monitor_id = "monitors"."id" and d.status = 'open' and d.severity = 'warning')`,
    })
    .from(monitors)
    .where(and(...where));
  const failures: { monitorId: string; name: string; reason: string }[] = [];
  for (const r of rows) {
    if (opts.failOn.includes('down') && r.status === 'down') failures.push({ monitorId: r.id, name: r.name, reason: 'down' });
    if (opts.failOn.includes('unknown') && r.status === 'unknown')
      failures.push({ monitorId: r.id, name: r.name, reason: 'not checked yet' });
    if (opts.failOn.includes('breaking') && Number(r.breaking) > 0)
      failures.push({ monitorId: r.id, name: r.name, reason: `${r.breaking} open breaking drift event(s)` });
    if (opts.failOn.includes('warning') && Number(r.warning) > 0)
      failures.push({ monitorId: r.id, name: r.name, reason: `${r.warning} open warning drift event(s)` });
  }
  return {
    pass: failures.length === 0,
    evaluated: rows.length,
    failOn: opts.failOn,
    tags: opts.tags,
    failures,
    evaluatedAt: new Date().toISOString(),
  };
}
