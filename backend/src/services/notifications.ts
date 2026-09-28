import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { type Db, queryRows } from '../db/client.js';
import { notificationChannels, notificationDeliveries } from '../db/schema.js';
import { decryptJson, encryptJson, hmacSha256 } from '../lib/crypto.js';
import { notFound, validation } from '../lib/errors.js';
import { OutboundError, outboundRequest } from '../lib/http-client.js';
import { audit } from './audit.js';
import type { Actor, Ctx } from './context.js';

export const EVENT_TYPES = ['incident.opened', 'incident.resolved', 'drift.breaking', 'drift.warning', 'drift.info'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const DEFAULT_EVENTS: EventType[] = ['incident.opened', 'incident.resolved', 'drift.breaking', 'drift.warning'];
export const MAX_ATTEMPTS = 5;

type ChannelSecret = { url: string; secret?: string };
type ChannelRow = typeof notificationChannels.$inferSelect;

export type NotificationPayload = {
  event: EventType | 'test';
  occurredAt: string;
  summary: string;
  monitor?: { id: string; name: string; kind: string };
  incident?: { id: string; cause: string; openedAt: string; resolvedAt?: string | null };
  drift?: { id: string; severity: string; changes: { path: string; message: string; severity: string }[] };
  link?: string;
};

function toApi(row: ChannelRow) {
  const { configEnc: _omit, ...rest } = row;
  return rest;
}

function validateUrl(kind: 'webhook' | 'slack', url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw validation('Invalid URL.', [{ path: 'url', message: 'not a URL' }]);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw validation('URL must be http(s).', [{ path: 'url', message: 'scheme' }]);
  if (kind === 'slack' && u.protocol !== 'https:')
    throw validation('Slack webhook URLs must use https.', [{ path: 'url', message: 'scheme' }]);
  return u;
}

export async function listChannels(ctx: Ctx) {
  const rows = await ctx.db.select().from(notificationChannels).orderBy(asc(notificationChannels.name));
  return rows.map((r) => ({ ...toApi(r), hasSecret: !!decryptJson<ChannelSecret>(r.configEnc, ctx.config.encryptionKey).secret }));
}

export type ChannelInput = {
  name: string;
  kind: 'webhook' | 'slack';
  url: string;
  secret?: string | undefined;
  events?: EventType[] | undefined;
  enabled?: boolean | undefined;
};

export async function createChannel(ctx: Ctx, input: ChannelInput, actor: Actor) {
  const u = validateUrl(input.kind, input.url);
  const secret: ChannelSecret = { url: input.url, ...(input.secret ? { secret: input.secret } : {}) };
  const [row] = await ctx.db
    .insert(notificationChannels)
    .values({
      name: input.name.trim(),
      kind: input.kind,
      enabled: input.enabled ?? true,
      events: input.events ?? DEFAULT_EVENTS,
      configEnc: encryptJson(secret, ctx.config.encryptionKey),
      target: u.host,
    })
    .returning();
  await audit(ctx, actor, {
    action: 'channel.created',
    targetType: 'channel',
    targetId: row?.id ?? '',
    details: { name: input.name, kind: input.kind },
  });
  return { ...toApi(row as ChannelRow), hasSecret: !!input.secret };
}

export async function updateChannel(
  ctx: Ctx,
  id: string,
  patch: {
    name?: string | undefined;
    url?: string | undefined;
    secret?: string | null | undefined;
    events?: EventType[] | undefined;
    enabled?: boolean | undefined;
  },
  actor: Actor,
) {
  const [row] = await ctx.db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
  if (!row) throw notFound('Channel');
  const current = decryptJson<ChannelSecret>(row.configEnc, ctx.config.encryptionKey);
  const next: ChannelSecret = { url: patch.url ?? current.url };
  const secret = patch.secret === undefined ? current.secret : patch.secret;
  if (secret) next.secret = secret;
  const u = validateUrl(row.kind, next.url);
  const [updated] = await ctx.db
    .update(notificationChannels)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.events !== undefined ? { events: patch.events } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      configEnc: encryptJson(next, ctx.config.encryptionKey),
      target: u.host,
      updatedAt: new Date(),
    })
    .where(eq(notificationChannels.id, id))
    .returning();
  await audit(ctx, actor, {
    action: 'channel.updated',
    targetType: 'channel',
    targetId: id,
    details: { fields: Object.keys(patch).filter((k) => k !== 'secret' && k !== 'url'), urlChanged: patch.url !== undefined },
  });
  return { ...toApi(updated as ChannelRow), hasSecret: !!next.secret };
}

export async function deleteChannel(ctx: Ctx, id: string, actor: Actor) {
  const [row] = await ctx.db.delete(notificationChannels).where(eq(notificationChannels.id, id)).returning({ id: notificationChannels.id });
  if (!row) throw notFound('Channel');
  await audit(ctx, actor, { action: 'channel.deleted', targetType: 'channel', targetId: id });
}

export async function listDeliveries(ctx: Ctx, channelId: string, limit: number) {
  return ctx.db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.channelId, channelId))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(limit);
}

/** Inserts one outbox row per enabled channel subscribed to the event. Call inside the check transaction. */
export async function enqueue(db: Db, event: EventType, payload: NotificationPayload): Promise<number> {
  const channels = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(and(eq(notificationChannels.enabled, true), sql`${event} = any(${notificationChannels.events})`));
  if (!channels.length) return 0;
  await db
    .insert(notificationDeliveries)
    .values(channels.map((c) => ({ channelId: c.id, eventType: event, payload: payload as Record<string, unknown> })));
  return channels.length;
}

function slackBody(p: NotificationPayload) {
  const lines = [`*${p.summary}*`];
  for (const c of p.drift?.changes.slice(0, 10) ?? []) lines.push(`• [${c.severity}] ${c.message}`);
  if ((p.drift?.changes.length ?? 0) > 10) lines.push(`…and ${(p.drift?.changes.length ?? 0) - 10} more`);
  if (p.incident?.cause) lines.push(`Cause: ${p.incident.cause}`);
  if (p.link) lines.push(`<${p.link}|Open in Tripline>`);
  return { text: lines.join('\n') };
}

/** Sends one notification. Returns the HTTP status; throws on transport errors or non-2xx. */
export async function send(ctx: Ctx, channel: ChannelRow, payload: NotificationPayload, deliveryId: string): Promise<number> {
  const cfg = decryptJson<ChannelSecret>(channel.configEnc, ctx.config.encryptionKey);
  const body = JSON.stringify(channel.kind === 'slack' ? slackBody(payload) : payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-tripline-event': payload.event,
    'x-tripline-delivery': deliveryId,
  };
  if (channel.kind === 'webhook' && cfg.secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    headers['x-tripline-timestamp'] = timestamp;
    headers['x-tripline-signature'] = `sha256=${hmacSha256(cfg.secret, `${timestamp}.${body}`)}`;
  }
  const res = await outboundRequest({
    url: cfg.url,
    method: 'POST',
    headers,
    body,
    timeoutMs: 10_000,
    allowPrivate: ctx.config.allowPrivateTargets,
    maxBytes: 64 * 1024,
  });
  if (res.status < 200 || res.status >= 300)
    throw Object.assign(new Error(`Receiver responded with HTTP ${res.status}.`), { status: res.status });
  return res.status;
}

export async function testChannel(ctx: Ctx, id: string, actor: Actor) {
  const [channel] = await ctx.db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
  if (!channel) throw notFound('Channel');
  const payload: NotificationPayload = {
    event: 'test',
    occurredAt: new Date().toISOString(),
    summary: `Test notification from Tripline for channel "${channel.name}".`,
    link: ctx.config.appUrl,
  };
  const deliveryId = randomUUID();
  let result: { ok: boolean; status?: number; error?: string };
  try {
    result = { ok: true, status: await send(ctx, channel, payload, deliveryId) };
  } catch (err) {
    result = {
      ok: false,
      error: (err as Error).message,
      ...((err as { status?: number }).status ? { status: (err as { status: number }).status } : {}),
    };
  }
  await ctx.db.insert(notificationDeliveries).values({
    id: deliveryId,
    channelId: id,
    eventType: 'test',
    payload: payload as Record<string, unknown>,
    status: result.ok ? 'sent' : 'failed',
    attempts: 1,
    lastError: result.error ?? null,
    responseStatus: result.status ?? null,
    sentAt: result.ok ? new Date() : null,
  });
  await audit(ctx, actor, { action: 'channel.tested', targetType: 'channel', targetId: id, details: { ok: result.ok } });
  return result;
}

/**
 * Delivers due outbox rows. Rows are claimed by pushing `next_attempt_at` forward inside a
 * `FOR UPDATE SKIP LOCKED` sub-select, so concurrent workers never send the same row twice.
 */
export async function processOutbox(ctx: Ctx, limit = 20): Promise<{ sent: number; failed: number }> {
  const claimed = await queryRows<{ id: string }>(
    ctx.db,
    sql`
    update notification_deliveries set next_attempt_at = now() + interval '2 minutes'
    where id in (
      select id from notification_deliveries
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at limit ${limit} for update skip locked
    ) returning id`,
  );
  const ids = claimed.map((r) => r.id);
  if (!ids.length) return { sent: 0, failed: 0 };
  const rows = await ctx.db
    .select({ d: notificationDeliveries, c: notificationChannels })
    .from(notificationDeliveries)
    .innerJoin(notificationChannels, eq(notificationChannels.id, notificationDeliveries.channelId))
    .where(inArray(notificationDeliveries.id, ids));
  let sent = 0;
  let failed = 0;
  await Promise.all(
    rows.map(async ({ d, c }) => {
      const attempts = d.attempts + 1;
      try {
        const status = await send(ctx, c, d.payload as NotificationPayload, d.id);
        await ctx.db
          .update(notificationDeliveries)
          .set({ status: 'sent', attempts, responseStatus: status, sentAt: new Date(), lastError: null })
          .where(eq(notificationDeliveries.id, d.id));
        sent++;
      } catch (err) {
        const giveUp = attempts >= MAX_ATTEMPTS;
        const message = err instanceof OutboundError ? `${err.code}: ${err.message}` : (err as Error).message;
        await ctx.db
          .update(notificationDeliveries)
          .set({
            status: giveUp ? 'failed' : 'pending',
            attempts,
            lastError: message.slice(0, 500),
            responseStatus: (err as { status?: number }).status ?? null,
            nextAttemptAt: new Date(Date.now() + 30_000 * 2 ** (attempts - 1)),
          })
          .where(eq(notificationDeliveries.id, d.id));
        ctx.log.warn({ deliveryId: d.id, channelId: c.id, attempts, giveUp, error: message }, 'notification delivery failed');
        if (giveUp) failed++;
      }
    }),
  );
  return { sent, failed };
}
