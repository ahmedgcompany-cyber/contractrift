import { and, desc, eq, type SQL } from 'drizzle-orm';
import { baselines, driftEvents, monitors } from '../db/schema.js';
import { acceptObservation } from '../drift/diff.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import type { Actor, Ctx } from './context.js';

type DriftStatus = (typeof driftEvents.$inferSelect)['status'];

const columns = {
  id: driftEvents.id,
  monitorId: driftEvents.monitorId,
  monitorName: monitors.name,
  monitorKind: monitors.kind,
  detectedAt: driftEvents.detectedAt,
  lastSeenAt: driftEvents.lastSeenAt,
  occurrences: driftEvents.occurrences,
  severity: driftEvents.severity,
  changes: driftEvents.changes,
  status: driftEvents.status,
  decidedBy: driftEvents.decidedBy,
  decidedAt: driftEvents.decidedAt,
};

export async function listDrift(ctx: Ctx, f: { status?: DriftStatus | undefined; monitorId?: string | undefined; limit: number }) {
  const where: SQL[] = [];
  if (f.status) where.push(eq(driftEvents.status, f.status));
  if (f.monitorId) where.push(eq(driftEvents.monitorId, f.monitorId));
  return ctx.db
    .select(columns)
    .from(driftEvents)
    .innerJoin(monitors, eq(monitors.id, driftEvents.monitorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(driftEvents.detectedAt))
    .limit(f.limit);
}

export async function getDrift(ctx: Ctx, id: string) {
  const [row] = await ctx.db
    .select(columns)
    .from(driftEvents)
    .innerJoin(monitors, eq(monitors.id, driftEvents.monitorId))
    .where(eq(driftEvents.id, id));
  if (!row) throw notFound('Drift event');
  return row;
}

/** Accepting makes the observed structure the new baseline. */
export async function acceptDrift(ctx: Ctx, id: string, actor: Actor) {
  await ctx.db.transaction(async (tx) => {
    const [event] = await tx.select().from(driftEvents).where(eq(driftEvents.id, id)).for('update');
    if (!event) throw notFound('Drift event');
    if (event.status !== 'open') throw conflict(`This drift event is already ${event.status}.`);
    const [b] = await tx.select().from(baselines).where(eq(baselines.monitorId, event.monitorId)).for('update');
    if (!b) throw new AppError('CONFLICT', 'The monitor has no baseline any more (it was reset).');
    const next = acceptObservation({ shape: b.shape, signature: b.signature }, event.observedShape, event.observedSignature);
    await tx
      .update(baselines)
      .set({ shape: next.shape, signature: next.signature, updatedAt: new Date() })
      .where(eq(baselines.monitorId, event.monitorId));
    await tx.update(driftEvents).set({ status: 'accepted', decidedBy: actor.userId, decidedAt: new Date() }).where(eq(driftEvents.id, id));
  });
  await audit(ctx, actor, { action: 'drift.accepted', targetType: 'drift_event', targetId: id });
  return getDrift(ctx, id);
}

/** Dismissing mutes this exact set of changes; the baseline is unchanged. */
export async function dismissDrift(ctx: Ctx, id: string, actor: Actor) {
  const [row] = await ctx.db
    .update(driftEvents)
    .set({ status: 'dismissed', decidedBy: actor.userId, decidedAt: new Date() })
    .where(and(eq(driftEvents.id, id), eq(driftEvents.status, 'open')))
    .returning({ id: driftEvents.id });
  if (!row) {
    await getDrift(ctx, id); // 404 if missing
    throw conflict('This drift event is not open.');
  }
  await audit(ctx, actor, { action: 'drift.dismissed', targetType: 'drift_event', targetId: id });
  return getDrift(ctx, id);
}
