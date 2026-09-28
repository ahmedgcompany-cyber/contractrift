import { desc, eq, lt } from 'drizzle-orm';
import { auditLog, users } from '../db/schema.js';
import type { Actor, Ctx } from './context.js';

export type AuditEntry = { action: string; targetType?: string; targetId?: string; details?: Record<string, unknown> };

export async function audit(ctx: Pick<Ctx, 'db'>, actor: Actor, entry: AuditEntry): Promise<void> {
  await ctx.db.insert(auditLog).values({
    userId: actor.userId,
    ip: actor.ip ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? {},
  });
}

export async function listAudit(ctx: Ctx, opts: { limit: number; before?: number | undefined }) {
  const rows = await ctx.db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details,
      ip: auditLog.ip,
      createdAt: auditLog.createdAt,
      userId: auditLog.userId,
      userEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(opts.before ? lt(auditLog.id, opts.before) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(opts.limit);
  return rows;
}
