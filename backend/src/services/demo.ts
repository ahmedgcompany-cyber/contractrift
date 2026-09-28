import { eq, sql } from 'drizzle-orm';
import { monitors, users } from '../db/schema.js';
import { hashPassword, type UserRow } from './auth.js';
import type { Ctx } from './context.js';
import { createMonitor, type MonitorInput } from './monitors.js';

/**
 * Public demo mode (DEMO_MODE=true): a shared read-only viewer account whose credentials are shown
 * on the login page, plus monitors against real public services. The demo account cannot change
 * its password, create API tokens or be locked out (its password is public anyway).
 */
export function isDemoUser(ctx: Ctx, user: Pick<UserRow, 'email'>): boolean {
  return ctx.config.demoMode && user.email.toLowerCase() === ctx.config.demoEmail.toLowerCase();
}

export const DEMO_MONITORS: MonitorInput[] = [
  {
    name: 'GitHub REST API · nodejs/node',
    kind: 'http',
    intervalSeconds: 900,
    tags: ['demo', 'rest'],
    config: {
      url: 'https://api.github.com/repos/nodejs/node',
      headers: { accept: 'application/vnd.github+json' },
      assertions: [{ path: '$.full_name', op: 'equals', value: 'nodejs/node' }],
    },
  },
  {
    name: 'Hugging Face MCP (2026-07-28 stateless)',
    kind: 'mcp',
    intervalSeconds: 900,
    tags: ['demo', 'mcp'],
    config: { url: 'https://huggingface.co/mcp', expectedTools: ['hub_repo_search'] },
  },
  {
    name: 'DeepWiki MCP (initialize-based)',
    kind: 'mcp',
    intervalSeconds: 900,
    tags: ['demo', 'mcp'],
    config: {
      url: 'https://mcp.deepwiki.com/mcp',
      expectedTools: ['read_wiki_structure'],
      toolCall: { name: 'read_wiki_structure', arguments: { repoName: 'nodejs/node' } },
    },
  },
];

export async function ensureDemo(ctx: Ctx): Promise<void> {
  if (!ctx.config.demoMode) return;
  const email = ctx.config.demoEmail;
  const [existing] = await ctx.db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  const passwordHash = await hashPassword(ctx.config.demoPassword);
  if (!existing) {
    await ctx.db.insert(users).values({ email, name: 'Demo visitor', role: 'viewer', passwordHash, mustChangePassword: false });
  } else {
    // Keep the published credentials working and the account read-only.
    await ctx.db
      .update(users)
      .set({ passwordHash, role: 'viewer', disabled: false, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, existing.id));
  }
  for (const m of DEMO_MONITORS) {
    const [found] = await ctx.db.select({ id: monitors.id }).from(monitors).where(eq(monitors.name, m.name));
    if (!found) await createMonitor(ctx, m, { userId: null, ip: 'demo-seed' });
  }
}
