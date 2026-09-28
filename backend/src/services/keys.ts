import { eq, isNotNull } from 'drizzle-orm';
import { monitors, notificationChannels } from '../db/schema.js';
import { decrypt, encrypt } from '../lib/crypto.js';
import { audit } from './audit.js';
import type { Actor, Ctx } from './context.js';

type Counts = { total: number; reencrypted: number; failed: number };
export type ReencryptReport = { monitors: Counts; channels: Counts };

/**
 * Re-encrypts every stored secret with the current ENCRYPTION_KEY. Values already readable with
 * the current key are left alone; values readable only with an ENCRYPTION_KEY_PREVIOUS key are
 * rewritten; values no configured key can read are counted as failed and left untouched.
 * Idempotent.
 */
export async function reencryptAll(ctx: Ctx, actor: Actor = { userId: null, ip: 'system' }): Promise<ReencryptReport> {
  const current = ctx.config.encryptionKey;
  const rotate = (payload: string): { status: 'current' | 'failed' } | { status: 'rotated'; value: string } => {
    try {
      decrypt(payload, current);
      return { status: 'current' };
    } catch {
      /* not encrypted with the current key */
    }
    try {
      return { status: 'rotated', value: encrypt(decrypt(payload, ctx.config.decryptionKeys), current) };
    } catch {
      return { status: 'failed' };
    }
  };

  const report: ReencryptReport = { monitors: { total: 0, reencrypted: 0, failed: 0 }, channels: { total: 0, reencrypted: 0, failed: 0 } };

  const ms = await ctx.db.select({ id: monitors.id, enc: monitors.secretsEnc }).from(monitors).where(isNotNull(monitors.secretsEnc));
  for (const m of ms) {
    report.monitors.total++;
    const r = rotate(m.enc!);
    if (r.status === 'failed') report.monitors.failed++;
    if (r.status === 'rotated') {
      await ctx.db.update(monitors).set({ secretsEnc: r.value }).where(eq(monitors.id, m.id));
      report.monitors.reencrypted++;
    }
  }

  const cs = await ctx.db.select({ id: notificationChannels.id, enc: notificationChannels.configEnc }).from(notificationChannels);
  for (const c of cs) {
    report.channels.total++;
    const r = rotate(c.enc);
    if (r.status === 'failed') report.channels.failed++;
    if (r.status === 'rotated') {
      await ctx.db.update(notificationChannels).set({ configEnc: r.value }).where(eq(notificationChannels.id, c.id));
      report.channels.reencrypted++;
    }
  }

  if (report.monitors.reencrypted || report.channels.reencrypted || report.monitors.failed || report.channels.failed) {
    await audit(ctx, actor, { action: 'secrets.reencrypted', details: { ...report } });
  }
  return report;
}
