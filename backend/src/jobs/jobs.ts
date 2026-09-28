import { and, lt, ne, sql } from 'drizzle-orm';
import { queryRows } from '../db/client.js';
import { checkResults, notificationDeliveries, sessions } from '../db/schema.js';
import type { Ctx } from '../services/context.js';
import type { MonitorRow } from '../services/monitors.js';
import { processOutbox } from '../services/notifications.js';
import { runMonitor } from '../services/runner.js';

/**
 * Claims up to `limit` due monitors and advances their next_run_at in the same statement.
 * `FOR UPDATE SKIP LOCKED` makes concurrent schedulers (several instances) never claim the same row.
 */
export async function claimDueMonitors(ctx: Ctx, limit: number): Promise<MonitorRow[]> {
  if (limit <= 0) return [];
  const rows = await queryRows<{ id: string }>(
    ctx.db,
    sql`
    update monitors set next_run_at = now() + make_interval(secs => interval_seconds)
    where id in (
      select id from monitors
      where enabled and next_run_at <= now()
      order by next_run_at limit ${limit} for update skip locked
    ) returning id`,
  );
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  return ctx.db.query.monitors.findMany({ where: (m, { inArray }) => inArray(m.id, ids) });
}

export async function pruneOldData(ctx: Ctx) {
  const cutoff = new Date(Date.now() - ctx.config.retentionDays * 86_400_000);
  const results = await ctx.db.delete(checkResults).where(lt(checkResults.startedAt, cutoff)).returning({ id: checkResults.id });
  const deliveries = await ctx.db
    .delete(notificationDeliveries)
    .where(and(lt(notificationDeliveries.createdAt, cutoff), ne(notificationDeliveries.status, 'pending')))
    .returning({ id: notificationDeliveries.id });
  const expired = await ctx.db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
  return { checkResults: results.length, deliveries: deliveries.length, sessions: expired.length };
}

/** In-process background jobs: scheduler, notification outbox, retention. */
export class Jobs {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<Promise<unknown>>();
  private stopping = false;
  private ticking = false;
  private delivering = false;

  constructor(private readonly ctx: Ctx) {}

  start() {
    const { schedulerTickMs } = this.ctx.config;
    this.timers.push(setInterval(() => void this.tick(), schedulerTickMs));
    this.timers.push(setInterval(() => void this.deliver(), Math.max(1000, schedulerTickMs)));
    this.timers.push(setInterval(() => void this.retention(), 3600_000));
    void this.tick();
    void this.retention();
    this.ctx.log.info({ tickMs: schedulerTickMs, concurrency: this.ctx.config.schedulerConcurrency }, 'background jobs started');
  }

  async tick() {
    if (this.stopping || this.ticking) return;
    this.ticking = true;
    try {
      const due = await claimDueMonitors(this.ctx, this.ctx.config.schedulerConcurrency - this.running.size);
      for (const m of due) {
        const p = runMonitor(this.ctx, m)
          .catch((err) => this.ctx.log.error({ err, monitorId: m.id }, 'check failed to record'))
          .finally(() => this.running.delete(p));
        this.running.add(p);
      }
    } catch (err) {
      this.ctx.log.error({ err }, 'scheduler tick failed');
    } finally {
      this.ticking = false;
    }
  }

  async deliver() {
    if (this.stopping || this.delivering) return;
    this.delivering = true;
    try {
      await processOutbox(this.ctx);
    } catch (err) {
      this.ctx.log.error({ err }, 'notification delivery tick failed');
    } finally {
      this.delivering = false;
    }
  }

  async retention() {
    try {
      const removed = await pruneOldData(this.ctx);
      this.ctx.log.info({ removed }, 'retention pruning completed');
    } catch (err) {
      this.ctx.log.error({ err }, 'retention pruning failed');
    }
  }

  /** Stops timers and waits (bounded) for in-flight checks to finish. */
  async stop(timeoutMs = 15_000) {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    await Promise.race([Promise.allSettled([...this.running]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}
