import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { validation } from '../lib/errors.js';
import { listAudit } from '../services/audit.js';
import type { Ctx } from '../services/context.js';
import { evaluateGate, type GateFailOn, summary } from '../services/overview.js';
import { AuditEntry, errors, Gate, Summary } from './schemas.js';

export const systemRoutes =
  (ctx: Ctx): FastifyPluginAsyncTypebox =>
  async (app) => {
    app.get(
      '/summary',
      {
        config: { role: 'viewer' },
        schema: { tags: ['system'], summary: 'Dashboard counters', response: { 200: Summary, ...errors(401) } },
      },
      async () => summary(ctx),
    );

    app.get(
      '/gate',
      {
        config: { role: 'viewer' },
        schema: {
          tags: ['system'],
          summary: 'CI deploy gate. Always HTTP 200; check `pass`. Use an API token.',
          querystring: Type.Object({
            tags: Type.Optional(
              Type.String({ maxLength: 500, description: 'Comma-separated tags; monitors with any of them are evaluated. Empty = all.' }),
            ),
            failOn: Type.Optional(
              Type.String({
                maxLength: 100,
                default: 'down,breaking',
                description: 'Comma-separated subset of down, unknown, breaking, warning.',
              }),
            ),
          }),
          response: { 200: Gate, ...errors(400, 401) },
        },
      },
      async (req) => {
        const split = (s: string | undefined) =>
          (s ?? '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean);
        const failOn = split(req.query.failOn ?? 'down,breaking');
        const allowed = ['down', 'unknown', 'breaking', 'warning'];
        const bad = failOn.filter((f) => !allowed.includes(f));
        if (bad.length) throw validation(`Unknown failOn value(s): ${bad.join(', ')}`);
        return evaluateGate(ctx, { tags: split(req.query.tags), failOn: failOn as GateFailOn[] });
      },
    );

    app.get(
      '/audit',
      {
        config: { role: 'admin' },
        schema: {
          tags: ['system'],
          summary: 'Audit log, newest first (cursor pagination by id)',
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 100 })),
            before: Type.Optional(Type.Integer({ minimum: 1 })),
          }),
          response: { 200: Type.Object({ entries: Type.Array(AuditEntry) }), ...errors(401, 403) },
        },
      },
      async (req) => ({ entries: (await listAudit(ctx, { limit: req.query.limit ?? 100, before: req.query.before })) as never }),
    );
  };
