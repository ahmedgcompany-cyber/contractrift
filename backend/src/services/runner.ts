import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { baselines, checkResults, driftEvents, incidents, monitors } from '../db/schema.js';
import { diffBaseline, fingerprint, maxSeverity } from '../drift/diff.js';
import { inferShape, mergeShapes } from '../drift/shape.js';
import type { MonitorKind, ProbeSecrets } from '../probes/config.js';
import { normalizeConfig, runProbe } from '../probes/index.js';
import type { ProbeOutcome } from '../probes/types.js';
import type { Ctx } from './context.js';
import { applySecretsPatch, getMonitorRow, type MonitorRow, readSecrets, type SecretsPatch } from './monitors.js';
import { enqueue, type NotificationPayload } from './notifications.js';

export type RunSummary = {
  result: typeof checkResults.$inferSelect;
  status: MonitorRow['status'];
  incident: 'opened' | 'resolved' | 'ongoing' | null;
  baseline: 'learning' | 'locked' | 'disabled' | 'skipped';
  drift: { eventId: string; severity: string; isNew: boolean; changes: number } | null;
};

async function probe(ctx: Ctx, kind: MonitorKind, config: unknown, secrets: ProbeSecrets, timeoutMs: number): Promise<ProbeOutcome> {
  try {
    return await runProbe(kind, config, secrets, { timeoutMs, allowPrivateTargets: ctx.config.allowPrivateTargets });
  } catch (err) {
    ctx.log.error({ err }, 'probe crashed');
    return {
      ok: false,
      durationMs: 0,
      errorCode: 'INTERNAL',
      message: 'The probe failed unexpectedly; see server logs.',
      assertions: [],
      signature: {},
      meta: {},
    };
  }
}

/** Runs a probe without persisting anything (the "Test" button). */
export async function dryRun(
  ctx: Ctx,
  input: {
    kind: MonitorKind;
    config: unknown;
    secrets?: SecretsPatch | undefined;
    timeoutMs?: number | undefined;
    monitorId?: string | undefined;
  },
) {
  const config = normalizeConfig(input.kind, input.config);
  let stored: ProbeSecrets = {};
  if (input.monitorId) {
    const row = await getMonitorRow(ctx, input.monitorId);
    if (row.kind === input.kind) stored = readSecrets(ctx, row);
  }
  const secrets = applySecretsPatch(stored, input.secrets);
  const outcome = await probe(ctx, input.kind, config, secrets, input.timeoutMs ?? 10_000);
  const { observed, ...rest } = outcome;
  const shape = observed === undefined ? null : inferShape(observed);
  return { ...rest, observedPaths: shape ? Object.keys(shape.paths).length : 0 };
}

export async function runMonitor(ctx: Ctx, monitor: MonitorRow): Promise<RunSummary | null> {
  const startedAt = new Date();
  let secrets: ProbeSecrets;
  try {
    secrets = readSecrets(ctx, monitor);
  } catch (err) {
    ctx.log.error({ monitorId: monitor.id, err }, 'cannot decrypt monitor secrets (ENCRYPTION_KEY changed?)');
    return record(ctx, monitor.id, startedAt, {
      ok: false,
      durationMs: 0,
      errorCode: 'CONFIG',
      message: 'Stored secrets could not be decrypted. Was ENCRYPTION_KEY changed? Re-enter the secrets.',
      assertions: [],
      signature: {},
      meta: {},
    });
  }
  const outcome = await probe(ctx, monitor.kind, monitor.config, secrets, monitor.timeoutMs);
  const summary = await record(ctx, monitor.id, startedAt, outcome);
  ctx.log.info(
    {
      monitorId: monitor.id,
      kind: monitor.kind,
      ok: outcome.ok,
      durationMs: outcome.durationMs,
      errorCode: outcome.errorCode,
      drift: summary?.drift?.severity,
    },
    'check completed',
  );
  return summary;
}

const link = (ctx: Ctx, monitorId: string) => `${ctx.config.appUrl}/monitors/${monitorId}`;

/** Persists one outcome and applies availability + drift rules atomically. Returns null if the monitor was deleted meanwhile. */
export async function record(ctx: Ctx, monitorId: string, startedAt: Date, outcome: ProbeOutcome): Promise<RunSummary | null> {
  return ctx.db.transaction(async (tx) => {
    const [m] = await tx.select().from(monitors).where(eq(monitors.id, monitorId)).for('update');
    if (!m) return null;

    const [result] = await tx
      .insert(checkResults)
      .values({
        monitorId,
        startedAt,
        durationMs: outcome.durationMs,
        ok: outcome.ok,
        statusCode: outcome.statusCode ?? null,
        errorCode: outcome.errorCode ?? null,
        message: outcome.message.slice(0, 2000),
        assertions: outcome.assertions,
        meta: outcome.meta,
        responseExcerpt: outcome.ok ? null : (outcome.excerpt ?? null),
      })
      .returning();

    const availability = await applyAvailability(ctx, tx as unknown as Db, m, outcome);
    const drift = await applyDrift(ctx, tx as unknown as Db, m, outcome);
    return { result: result as typeof checkResults.$inferSelect, ...availability, ...drift };
  });
}

async function applyAvailability(ctx: Ctx, tx: Db, m: MonitorRow, outcome: ProbeOutcome) {
  const failures = outcome.ok ? 0 : m.consecutiveFailures + 1;
  const [open] = await tx
    .select()
    .from(incidents)
    .where(and(eq(incidents.monitorId, m.id), isNull(incidents.resolvedAt)));
  let incident: RunSummary['incident'] = null;
  const monitorRef = { id: m.id, name: m.name, kind: m.kind };

  if (outcome.ok && open) {
    const resolvedAt = new Date();
    await tx.update(incidents).set({ resolvedAt }).where(eq(incidents.id, open.id));
    incident = 'resolved';
    await enqueue(tx, 'incident.resolved', {
      event: 'incident.resolved',
      occurredAt: resolvedAt.toISOString(),
      summary: `RESOLVED: ${m.name} is responding normally again.`,
      monitor: monitorRef,
      incident: { id: open.id, cause: open.cause, openedAt: open.openedAt.toISOString(), resolvedAt: resolvedAt.toISOString() },
      link: link(ctx, m.id),
    });
  } else if (!outcome.ok && open) {
    await tx
      .update(incidents)
      .set({ lastError: outcome.message.slice(0, 2000), failureCount: open.failureCount + 1 })
      .where(eq(incidents.id, open.id));
    incident = 'ongoing';
  } else if (!outcome.ok && failures >= m.failureThreshold) {
    const cause = `${outcome.errorCode ?? 'FAILED'}: ${outcome.message}`.slice(0, 2000);
    const [created] = await tx.insert(incidents).values({ monitorId: m.id, cause, lastError: cause, failureCount: failures }).returning();
    incident = 'opened';
    await enqueue(tx, 'incident.opened', {
      event: 'incident.opened',
      occurredAt: new Date().toISOString(),
      summary: `DOWN: ${m.name} failed ${failures} consecutive checks.`,
      monitor: monitorRef,
      incident: { id: created?.id ?? '', cause, openedAt: (created?.openedAt ?? new Date()).toISOString() },
      link: link(ctx, m.id),
    });
  }

  // Below the threshold the previous status is kept, so one blip doesn't flap the dashboard.
  const status: MonitorRow['status'] = outcome.ok ? 'up' : failures >= m.failureThreshold ? 'down' : m.status;
  await tx
    .update(monitors)
    .set({
      status,
      consecutiveFailures: failures,
      lastCheckedAt: new Date(),
      lastDurationMs: outcome.durationMs,
      lastError: outcome.ok ? null : outcome.message.slice(0, 2000),
    })
    .where(eq(monitors.id, m.id));
  return { status, incident };
}

async function applyDrift(ctx: Ctx, tx: Db, m: MonitorRow, outcome: ProbeOutcome): Promise<Pick<RunSummary, 'baseline' | 'drift'>> {
  if (!m.driftEnabled) return { baseline: 'disabled', drift: null };
  if (outcome.observed === undefined) return { baseline: 'skipped', drift: null };
  const shape = inferShape(outcome.observed, m.ignorePaths);
  const [b] = await tx.select().from(baselines).where(eq(baselines.monitorId, m.id)).for('update');

  if (!b || !b.lockedAt) {
    const merged = b ? mergeShapes(b.shape, shape) : shape;
    const lockedAt = merged.samples >= m.baselineSamples ? new Date() : null;
    await tx
      .insert(baselines)
      .values({ monitorId: m.id, shape: merged, signature: outcome.signature, lockedAt })
      .onConflictDoUpdate({
        target: baselines.monitorId,
        set: { shape: merged, signature: outcome.signature, lockedAt, updatedAt: new Date() },
      });
    return { baseline: lockedAt ? 'locked' : 'learning', drift: null };
  }

  const changes = diffBaseline({ shape: b.shape, signature: b.signature }, shape, outcome.signature);
  if (changes.length === 0) return { baseline: 'locked', drift: null };
  const fp = fingerprint(changes);
  const severity = maxSeverity(changes) ?? 'info';
  const [existing] = await tx
    .select()
    .from(driftEvents)
    .where(and(eq(driftEvents.monitorId, m.id), eq(driftEvents.fingerprint, fp), inArray(driftEvents.status, ['open', 'dismissed'])));
  if (existing) {
    if (existing.status === 'open') {
      await tx
        .update(driftEvents)
        .set({ lastSeenAt: new Date(), occurrences: existing.occurrences + 1 })
        .where(eq(driftEvents.id, existing.id));
    }
    return { baseline: 'locked', drift: { eventId: existing.id, severity: existing.severity, isNew: false, changes: changes.length } };
  }
  const [event] = await tx
    .insert(driftEvents)
    .values({ monitorId: m.id, severity, fingerprint: fp, changes, observedShape: shape, observedSignature: outcome.signature })
    .returning();
  const payload: NotificationPayload = {
    event: `drift.${severity}`,
    occurredAt: new Date().toISOString(),
    summary: `${severity.toUpperCase()} DRIFT: ${m.name} — ${changes.length} change${changes.length === 1 ? '' : 's'} vs. baseline.`,
    monitor: { id: m.id, name: m.name, kind: m.kind },
    drift: { id: event?.id ?? '', severity, changes: changes.map((c) => ({ path: c.path, message: c.message, severity: c.severity })) },
    link: link(ctx, m.id),
  };
  await enqueue(tx, `drift.${severity}`, payload);
  return { baseline: 'locked', drift: { eventId: event?.id ?? '', severity, isNew: true, changes: changes.length } };
}
