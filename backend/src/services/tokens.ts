import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { apiTokens, users } from '../db/schema.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import type { UserRow } from './auth.js';
import type { Actor, Ctx } from './context.js';

export const TOKEN_PREFIX = 'tl_';

const publicColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
  expiresAt: apiTokens.expiresAt,
};

export async function listTokens(ctx: Ctx, userId: string) {
  return ctx.db
    .select(publicColumns)
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

/** Creates a read-only API token. The plaintext is returned exactly once. */
export async function createToken(ctx: Ctx, userId: string, input: { name: string; expiresInDays?: number | undefined }, actor: Actor) {
  const token = `${TOKEN_PREFIX}${randomToken()}`;
  const [row] = await ctx.db
    .insert(apiTokens)
    .values({
      userId,
      name: input.name.trim(),
      tokenHash: sha256(token),
      prefix: token.slice(0, 10),
      expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
    })
    .returning(publicColumns);
  await audit(ctx, actor, { action: 'token.created', targetType: 'api_token', targetId: row?.id ?? '', details: { name: input.name } });
  return { ...row, token };
}

export async function revokeToken(ctx: Ctx, userId: string, id: string, actor: Actor) {
  const [row] = await ctx.db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!row) throw notFound('API token');
  await audit(ctx, actor, { action: 'token.revoked', targetType: 'api_token', targetId: id });
}

export async function resolveToken(ctx: Ctx, token: string): Promise<UserRow | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const [row] = await ctx.db
    .select({ token: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, sha256(token)),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    );
  if (!row || row.user.disabled) return null;
  if (!row.token.lastUsedAt || Date.now() - row.token.lastUsedAt.getTime() > 60_000) {
    await ctx.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.token.id));
  }
  return row.user;
}
