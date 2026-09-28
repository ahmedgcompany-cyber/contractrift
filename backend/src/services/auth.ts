import { hash, verify } from '@node-rs/argon2';
import { and, count, eq, gt, ne, sql } from 'drizzle-orm';
import { sessions, users } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { AppError, validation } from '../lib/errors.js';
import { audit } from './audit.js';
import { isDemoUser } from './demo.js';
import type { Actor, Ctx } from './context.js';

export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MINUTES = 15;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

// A valid argon2id hash of a random string, used to equalize timing for unknown emails.
let dummyHash: Promise<string> | undefined;

export type UserRow = typeof users.$inferSelect;
export type PublicUser = Pick<UserRow, 'id' | 'email' | 'name' | 'role' | 'disabled' | 'mustChangePassword' | 'lastLoginAt' | 'createdAt'>;

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    disabled: u.disabled,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export function checkPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw validation(`Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`, [{ path: 'password', message: 'length' }]);
  }
}

export const hashPassword = (password: string) => hash(password, { algorithm: 2 /* argon2id */ });

export async function needsSetup(ctx: Ctx): Promise<boolean> {
  const [row] = await ctx.db.select({ n: count() }).from(users);
  return (row?.n ?? 0) === 0;
}

/** Creates the first admin. Serialized with an advisory lock so two racing requests can't both succeed. */
export async function setupFirstAdmin(ctx: Ctx, input: { email: string; name: string; password: string }, ip?: string) {
  checkPasswordPolicy(input.password);
  const passwordHash = await hashPassword(input.password);
  const user = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7426001)`);
    const [row] = await tx.select({ n: count() }).from(users);
    if ((row?.n ?? 0) > 0) throw new AppError('SETUP_ALREADY_DONE', 'Setup has already been completed.');
    const [created] = await tx
      .insert(users)
      .values({ email: input.email.trim(), name: input.name.trim(), passwordHash, role: 'admin' })
      .returning();
    return created as UserRow;
  });
  await audit(ctx, { userId: user.id, ip }, { action: 'setup.completed', targetType: 'user', targetId: user.id });
  return user;
}

export async function createSession(ctx: Ctx, userId: string, meta: { ip?: string | undefined; userAgent?: string | undefined }) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ctx.config.sessionTtlHours * 3600_000);
  await ctx.db.insert(sessions).values({
    id: sha256(token),
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

export async function login(ctx: Ctx, input: { email: string; password: string; ip?: string | undefined; userAgent?: string | undefined }) {
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${input.email.trim()})`);
  const invalid = new AppError('UNAUTHENTICATED', 'Invalid email or password.');
  if (!user) {
    dummyHash ??= hashPassword(randomToken());
    await verify(await dummyHash, input.password).catch(() => false);
    await audit(ctx, { userId: null, ip: input.ip }, { action: 'auth.login_failed', details: { reason: 'unknown_email' } });
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or ask an administrator.');
  }
  const ok = await verify(user.passwordHash, input.password).catch(() => false);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    // The shared demo account's password is public; locking it would only let anyone deny the demo.
    const lock = failures >= MAX_FAILED_LOGINS && !isDemoUser(ctx, user);
    await ctx.db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    await audit(
      ctx,
      { userId: user.id, ip: input.ip },
      { action: lock ? 'auth.account_locked' : 'auth.login_failed', targetType: 'user', targetId: user.id },
    );
    throw invalid;
  }
  if (user.disabled) throw invalid;
  await ctx.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
  const session = await createSession(ctx, user.id, input);
  await audit(ctx, { userId: user.id, ip: input.ip }, { action: 'auth.login', targetType: 'user', targetId: user.id });
  return { ...session, user: toPublicUser(user) };
}

/** Resolves a session token to its user; slides expiry at most once a minute. */
export async function resolveSession(ctx: Ctx, token: string): Promise<{ user: UserRow; sessionId: string } | null> {
  const id = sha256(token);
  const [row] = await ctx.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  if (!row || row.user.disabled) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > 60_000) {
    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ctx.config.sessionTtlHours * 3600_000) })
      .where(eq(sessions.id, id));
  }
  return { user: row.user, sessionId: id };
}

export async function logout(ctx: Ctx, sessionId: string, actor: Actor) {
  await ctx.db.delete(sessions).where(eq(sessions.id, sessionId));
  await audit(ctx, actor, { action: 'auth.logout' });
}

export async function changePassword(ctx: Ctx, user: UserRow, sessionId: string | null, current: string, next: string, actor: Actor) {
  if (!(await verify(user.passwordHash, current).catch(() => false))) {
    throw validation('Current password is incorrect.', [{ path: 'currentPassword', message: 'incorrect' }]);
  }
  checkPasswordPolicy(next);
  if (current === next) throw validation('The new password must be different.', [{ path: 'newPassword', message: 'unchanged' }]);
  await ctx.db
    .update(users)
    .set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() })
    .where(eq(users.id, user.id));
  // Sign out every other session of this user.
  await ctx.db
    .delete(sessions)
    .where(sessionId ? and(eq(sessions.userId, user.id), ne(sessions.id, sessionId)) : eq(sessions.userId, user.id));
  await audit(ctx, actor, { action: 'auth.password_changed', targetType: 'user', targetId: user.id });
}
