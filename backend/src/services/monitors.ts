import { and, arrayOverlaps, asc, eq, ilike, or, type SQL, sql } from 'drizzle-orm';
import { queryRows } from '../db/client.js';
import { baselines, monitors } from '../db/schema.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { notFound, validation } from '../lib/errors.js';
import type { MonitorKind, ProbeSecrets } from '../probes/config.js';
import { normalizeConfig, normalizeSecrets } from '../probes/index.js';
import { audit } from './audit.js';
import type { Actor, Ctx } from './context.js';

export type MonitorRow = typeof monitors.$inferSelect;

export type MonitorInput = {
  name: string;
  kind: MonitorKind;
  enabled?: boolean | undefined;
  intervalSeconds?: number | undefined;
  timeoutMs?: number | undefined;
  failureThreshold?: number | undefined;
  baselineSamples?: number | undefined;
  driftEnabled?: boolean | undefined;
  ignorePaths?: string[] | undefined;
  tags?: string[] | undefined;
  config: Record<string, unknown>;
  secrets?: SecretsPatch | undefined;
};

/** `null` removes a secret, omission keeps it. */
export type SecretsPatch = { headers?: Record<string, string | null>; apiKey?: string | null };

export type MonitorPatch = Partial<Omit<MonitorInput, 'kind'>>;

export function readSecrets(ctx: Ctx, row: Pick<MonitorRow, 'secretsEnc'>): ProbeSecrets {
  return row.secretsEnc ? decryptJson<ProbeSecrets>(row.secretsEnc, ctx.config.encryptionKey) : {};
}

export function applySecretsPatch(current: ProbeSecrets, patch: SecretsPatch | undefined): ProbeSecrets {
  if (!patch) return current;
  const headers: Record<string, string> = { ...current.headers };
  for (const [k, v] of Object.entries(patch.headers ?? {})) {
    for (const existing of Object.keys(headers)) if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing];
    if (v !== null) headers[k] = v;
  }
  const next: ProbeSecrets = {};
  if (Object.keys(headers).length) next.headers = headers;
  const apiKey = patch.apiKey === undefined ? current.apiKey : patch.apiKey;
  if (apiKey) next.apiKey = apiKey;
  return normalizeSecrets(next);
}

/** API representation: never includes secret values, only which secrets are set. */
export function toApiMonitor(row: MonitorRow, secrets: ProbeSecrets) {
  const { secretsEnc: _omit, ...rest } = row;
  return { ...rest, secretKeys: { headers: Object.keys(secrets.headers ?? {}), apiKey: !!secrets.apiKey } };
}

function checkCommon(input: Partial<MonitorInput>) {
  const problems: { path: string; message: string }[] = [];
  const interval = input.intervalSeconds;
  const timeout = input.timeoutMs;
  if (interval !== undefined && timeout !== undefined && timeout > interval * 1000) {
    problems.push({ path: 'timeoutMs', message: 'Timeout must not exceed the check interval.' });
  }
  for (const p of input.ignorePaths ?? []) {
    if (!p.startsWith('$')) problems.push({ path: 'ignorePaths', message: `"${p}" must start with "$".` });
  }
  if (problems.length) throw validation('Invalid monitor.', problems);
}

const normTags = (tags: string[] | undefined) => (tags ? [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] : undefined);

export async function createMonitor(ctx: Ctx, input: MonitorInput, actor: Actor) {
  const config = normalizeConfig(input.kind, input.config);
  const secrets = applySecretsPatch({}, input.secrets);
  const values = {
    name: input.name.trim(),
    kind: input.kind,
    enabled: input.enabled ?? true,
    intervalSeconds: input.intervalSeconds ?? 300,
    timeoutMs: input.timeoutMs ?? 10_000,
    failureThreshold: input.failureThreshold ?? 2,
    baselineSamples: input.baselineSamples ?? 3,
    driftEnabled: input.driftEnabled ?? true,
    ignorePaths: input.ignorePaths ?? [],
    tags: normTags(input.tags) ?? [],
  };
  checkCommon(values);
  const [row] = await ctx.db
    .insert(monitors)
    .values({
      ...values,
      config: config as Record<string, unknown>,
      secretsEnc: Object.keys(secrets).length ? encryptJson(secrets, ctx.config.encryptionKey) : null,
      createdBy: actor.userId,
    })
    .returning();
  const created = row as MonitorRow;
  await audit(ctx, actor, {
    action: 'monitor.created',
    targetType: 'monitor',
    targetId: created.id,
    details: { name: created.name, kind: created.kind },
  });
  return toApiMonitor(created, secrets);
}

export async function getMonitorRow(ctx: Ctx, id: string): Promise<MonitorRow> {
  const [row] = await ctx.db.select().from(monitors).where(eq(monitors.id, id));
  if (!row) throw notFound('Monitor');
  return row;
}

export async function getMonitor(ctx: Ctx, id: string) {
  const row = await getMonitorRow(ctx, id);
  return toApiMonitor(row, readSecrets(ctx, row));
}

export type MonitorFilters = {
  q?: string | undefined;
  kind?: MonitorKind | undefined;
  status?: MonitorRow['status'] | undefined;
  tag?: string | undefined;
};

export async function listMonitors(ctx: Ctx, f: MonitorFilters) {
  const where: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(monitors.name, like), sql`${monitors.config}->>'url' ilike ${like}`) as SQL);
  }
  if (f.kind) where.push(eq(monitors.kind, f.kind));
  if (f.status) where.push(eq(monitors.status, f.status));
  if (f.tag) where.push(arrayOverlaps(monitors.tags, [f.tag.toLowerCase()]));
  const rows = await ctx.db
    .select()
    .from(monitors)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(monitors.name));
  if (rows.length === 0) return [];

  // Recent durations for sparklines in ONE query (avoids N+1 per monitor).
  const ids = rows.map((r) => r.id);
  const recent = await queryRows<{ monitor_id: string; points: { d: number; ok: boolean }[] }>(
    ctx.db,
    sql`
    select monitor_id, json_agg(json_build_object('d', duration_ms, 'ok', ok) order by started_at) as points
    from (
      select monitor_id, duration_ms, ok, started_at,
             row_number() over (partition by monitor_id order by started_at desc) as rn
      from check_results where monitor_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
    ) t where rn <= 30 group by monitor_id`,
  );
  const byId = new Map(recent.map((r) => [r.monitor_id, r.points]));
  const drift = await queryRows<{ monitor_id: string; n: number; worst: string }>(
    ctx.db,
    sql`
    select monitor_id, count(*)::int as n,
           (array_agg(severity order by case severity when 'breaking' then 0 when 'warning' then 1 else 2 end))[1] as worst
    from drift_events where status = 'open' and monitor_id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    group by monitor_id`,
  );
  const driftById = new Map(drift.map((r) => [r.monitor_id, { open: r.n, worst: r.worst }]));

  return rows.map((r) => ({
    ...toApiMonitor(r, readSecrets(ctx, r)),
    recent: byId.get(r.id) ?? [],
    openDrift: driftById.get(r.id) ?? { open: 0, worst: null },
  }));
}

export async function updateMonitor(ctx: Ctx, id: string, patch: MonitorPatch, actor: Actor) {
  const row = await getMonitorRow(ctx, id);
  const config = patch.config !== undefined ? normalizeConfig(row.kind, patch.config) : undefined;
  const secrets = applySecretsPatch(readSecrets(ctx, row), patch.secrets);
  const next = {
    intervalSeconds: patch.intervalSeconds ?? row.intervalSeconds,
    timeoutMs: patch.timeoutMs ?? row.timeoutMs,
    ignorePaths: patch.ignorePaths ?? row.ignorePaths,
  };
  checkCommon(next);
  const configChanged = config !== undefined && JSON.stringify(config) !== JSON.stringify(row.config);
  const ignoreChanged = patch.ignorePaths !== undefined && JSON.stringify(patch.ignorePaths) !== JSON.stringify(row.ignorePaths);
  const [updated] = await ctx.db
    .update(monitors)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.failureThreshold !== undefined ? { failureThreshold: patch.failureThreshold } : {}),
      ...(patch.baselineSamples !== undefined ? { baselineSamples: patch.baselineSamples } : {}),
      ...(patch.driftEnabled !== undefined ? { driftEnabled: patch.driftEnabled } : {}),
      ...(patch.tags !== undefined ? { tags: normTags(patch.tags) ?? [] } : {}),
      ...next,
      ...(config !== undefined ? { config: config as Record<string, unknown> } : {}),
      ...(patch.intervalSeconds !== undefined ? { nextRunAt: new Date() } : {}),
      ...(patch.enabled === false ? { status: 'unknown' as const, consecutiveFailures: 0 } : {}),
      secretsEnc: Object.keys(secrets).length ? encryptJson(secrets, ctx.config.encryptionKey) : null,
      updatedAt: new Date(),
    })
    .where(eq(monitors.id, id))
    .returning();
  // A different request (or ignore list) makes the learned structure meaningless: relearn it.
  if (configChanged || ignoreChanged) await ctx.db.delete(baselines).where(eq(baselines.monitorId, id));
  const changedSecrets = patch.secrets
    ? { headers: Object.keys(patch.secrets.headers ?? {}), apiKey: patch.secrets.apiKey !== undefined }
    : undefined;
  await audit(ctx, actor, {
    action: 'monitor.updated',
    targetType: 'monitor',
    targetId: id,
    details: {
      fields: Object.keys(patch).filter((k) => k !== 'secrets'),
      ...(changedSecrets ? { secretsChanged: changedSecrets } : {}),
      baselineReset: configChanged || ignoreChanged,
    },
  });
  return toApiMonitor(updated as MonitorRow, secrets);
}

export async function deleteMonitor(ctx: Ctx, id: string, actor: Actor) {
  const row = await getMonitorRow(ctx, id);
  await ctx.db.delete(monitors).where(eq(monitors.id, id));
  await audit(ctx, actor, { action: 'monitor.deleted', targetType: 'monitor', targetId: id, details: { name: row.name } });
}

export async function getBaseline(ctx: Ctx, id: string) {
  const row = await getMonitorRow(ctx, id);
  const [b] = await ctx.db.select().from(baselines).where(eq(baselines.monitorId, id));
  return {
    monitorId: id,
    state: !b ? 'none' : b.lockedAt ? 'locked' : 'learning',
    samples: b?.shape.samples ?? 0,
    samplesRequired: row.baselineSamples,
    lockedAt: b?.lockedAt ?? null,
    updatedAt: b?.updatedAt ?? null,
    paths: b
      ? Object.entries(b.shape.paths)
          .map(([path, info]) => ({
            path,
            types: info.types,
            required: info.count >= b.shape.samples,
            emptyArray: info.emptyArray ?? false,
          }))
          .sort((a, c) => a.path.localeCompare(c.path))
      : [],
    truncated: b?.shape.truncated ?? false,
    signature: b?.signature ?? {},
  };
}

export async function resetBaseline(ctx: Ctx, id: string, actor: Actor) {
  await getMonitorRow(ctx, id);
  await ctx.db.delete(baselines).where(eq(baselines.monitorId, id));
  await audit(ctx, actor, { action: 'monitor.baseline_reset', targetType: 'monitor', targetId: id });
}
