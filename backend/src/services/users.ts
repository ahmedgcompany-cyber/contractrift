import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { sessions, users } from '../db/schema.js';
import { randomToken } from '../lib/crypto.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { checkPasswordPolicy, hashPassword, toPublicUser, type UserRow } from './auth.js';
import type { Actor, Ctx } from './context.js';

export type Role = UserRow['role'];

export async function listUsers(ctx: Ctx) {
  const rows = await ctx.db.select().from(users).orderBy(asc(users.createdAt));
  return rows.map(toPublicUser);
}

async function emailTaken(ctx: Ctx, email: string, exceptId?: string) {
  const [row] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = lower(${email})`, exceptId ? ne(users.id, exceptId) : undefined));
  return !!row;
}

export async function createUser(ctx: Ctx, input: { email: string; name: string; role: Role; password: string }, actor: Actor) {
  checkPasswordPolicy(input.password);
  if (await emailTaken(ctx, input.email.trim())) throw conflict('A user with this email already exists.');
  const [created] = await ctx.db
    .insert(users)
    .values({
      email: input.email.trim(),
      name: input.name.trim(),
      role: input.role,
      passwordHash: await hashPassword(input.password),
      mustChangePassword: true,
    })
    .returning();
  const user = created as UserRow;
  await audit(ctx, actor, {
    action: 'user.created',
    targetType: 'user',
    targetId: user.id,
    details: { email: user.email, role: user.role },
  });
  return toPublicUser(user);
}

async function activeAdminCount(ctx: Ctx) {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false)));
  return row?.n ?? 0;
}

async function getUserRow(ctx: Ctx, id: string) {
  const [u] = await ctx.db.select().from(users).where(eq(users.id, id));
  if (!u) throw notFound('User');
  return u;
}

export async function updateUser(
  ctx: Ctx,
  id: string,
  patch: { name?: string | undefined; role?: Role | undefined; disabled?: boolean | undefined },
  actor: Actor,
) {
  const u = await getUserRow(ctx, id);
  const losesAdmin = u.role === 'admin' && !u.disabled && ((patch.role && patch.role !== 'admin') || patch.disabled === true);
  if (losesAdmin && (await activeAdminCount(ctx)) <= 1) {
    throw new AppError('CONFLICT', 'At least one active administrator is required.');
  }
  if (id === actor.userId && patch.disabled) throw new AppError('CONFLICT', 'You cannot disable your own account.');
  const [updated] = await ctx.db
    .update(users)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.disabled !== undefined ? { disabled: patch.disabled } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  if (patch.disabled) await ctx.db.delete(sessions).where(eq(sessions.userId, id));
  await audit(ctx, actor, { action: 'user.updated', targetType: 'user', targetId: id, details: { ...patch } });
  return toPublicUser(updated as UserRow);
}

/** Sets a random temporary password (returned once), forces a change and signs the user out. */
export async function resetPassword(ctx: Ctx, id: string, actor: Actor) {
  await getUserRow(ctx, id);
  const temporaryPassword = randomToken(12);
  await ctx.db
    .update(users)
    .set({
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
  await ctx.db.delete(sessions).where(eq(sessions.userId, id));
  await audit(ctx, actor, { action: 'user.password_reset', targetType: 'user', targetId: id });
  return { temporaryPassword };
}

export async function deleteUser(ctx: Ctx, id: string, actor: Actor) {
  const u = await getUserRow(ctx, id);
  if (id === actor.userId) throw new AppError('CONFLICT', 'You cannot delete your own account.');
  if (u.role === 'admin' && !u.disabled && (await activeAdminCount(ctx)) <= 1) {
    throw new AppError('CONFLICT', 'At least one active administrator is required.');
  }
  await ctx.db.delete(users).where(eq(users.id, id));
  await audit(ctx, actor, { action: 'user.deleted', targetType: 'user', targetId: id, details: { email: u.email } });
}
