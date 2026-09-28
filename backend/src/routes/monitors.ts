import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { actorOf } from '../plugins/auth.js';
import type { Ctx } from '../services/context.js';
import {
  createMonitor,
  deleteMonitor,
  getBaseline,
  getMonitor,
  getMonitorRow,
  listMonitors,
  resetBaseline,
  updateMonitor,
} from '../services/monitors.js';
import { listResults } from '../services/overview.js';
import { dryRun, runMonitor } from '../services/runner.js';
import {
  Baseline,
  CheckResult,
  DryRunResult,
  errors,
  IdParams,
  Monitor,
  MonitorKindSchema,
  MonitorListItem,
  MonitorStatusSchema,
  Nullable,
  RunSummary,
} from './schemas.js';

const Tag = Type.String({ minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9_.-]+$' });
const SecretsPatch = Type.Object(
  {
    headers: Type.Optional(Type.Record(Type.String({ maxLength: 128 }), Nullable(Type.String({ minLength: 1, maxLength: 8192 })))),
    query: Type.Optional(Type.Record(Type.String({ maxLength: 128 }), Nullable(Type.String({ minLength: 1, maxLength: 4096 })))),
    apiKey: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 4096 }))),
  },
  { additionalProperties: false, description: 'Secret values are write-only. `null` removes a secret; omitting keeps it.' },
);
const common = {
  name: Type.String({ minLength: 1, maxLength: 120 }),
  enabled: Type.Optional(Type.Boolean()),
  intervalSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 86_400 })),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 500, maximum: 60_000 })),
  failureThreshold: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  baselineSamples: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  driftEnabled: Type.Optional(Type.Boolean()),
  ignorePaths: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { maxItems: 50 })),
  tags: Type.Optional(Type.Array(Tag, { maxItems: 20 })),
  config: Type.Record(Type.String(), Type.Unknown(), { description: 'Kind-specific configuration; see API_DOCUMENTATION.md.' }),
  secrets: Type.Optional(SecretsPatch),
};

export const monitorRoutes =
  (ctx: Ctx): FastifyPluginAsyncTypebox =>
  async (app) => {
    const tags = ['monitors'];
    const viewer = { role: 'viewer' as const };
    const editor = { role: 'editor' as const };

    app.get(
      '/monitors',
      {
        config: viewer,
        schema: {
          tags,
          summary: 'List monitors (paginated, ordered by name) with recent check durations and open drift counts',
          querystring: Type.Object({
            q: Type.Optional(Type.String({ maxLength: 200 })),
            kind: Type.Optional(MonitorKindSchema),
            status: Type.Optional(MonitorStatusSchema),
            tag: Type.Optional(Tag),
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
            offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
          }),
          response: {
            200: Type.Object({
              monitors: Type.Array(MonitorListItem),
              total: Type.Integer(),
              limit: Type.Integer(),
              offset: Type.Integer(),
            }),
            ...errors(400, 401),
          },
        },
      },
      async (req) => {
        const page = await listMonitors(ctx, req.query);
        return { monitors: page.items as never, total: page.total, limit: page.limit, offset: page.offset };
      },
    );

    app.post(
      '/monitors',
      {
        config: editor,
        schema: {
          tags,
          summary: 'Create a monitor',
          body: Type.Object({ ...common, kind: MonitorKindSchema }, { additionalProperties: false }),
          response: { 201: Type.Object({ monitor: Monitor }), ...errors(400, 401, 403) },
        },
      },
      async (req, reply) => reply.status(201).send({ monitor: (await createMonitor(ctx, req.body as never, actorOf(req))) as never }),
    );

    app.post(
      '/monitors/test',
      {
        config: { ...editor, rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: 'Dry-run a monitor configuration without saving anything',
          body: Type.Object(
            {
              kind: MonitorKindSchema,
              config: common.config,
              secrets: Type.Optional(SecretsPatch),
              timeoutMs: common.timeoutMs,
              monitorId: Type.Optional(Type.String({ format: 'uuid', description: 'Reuse the stored secrets of this monitor' })),
            },
            { additionalProperties: false },
          ),
          response: { 200: DryRunResult, ...errors(400, 401, 403, 404, 429) },
        },
      },
      async (req) => (await dryRun(ctx, req.body as never)) as never,
    );

    app.get(
      '/monitors/:id',
      {
        config: viewer,
        schema: {
          tags,
          summary: 'Get a monitor',
          params: IdParams,
          response: { 200: Type.Object({ monitor: Monitor }), ...errors(401, 404) },
        },
      },
      async (req) => ({ monitor: (await getMonitor(ctx, req.params.id)) as never }),
    );

    app.patch(
      '/monitors/:id',
      {
        config: editor,
        schema: {
          tags,
          summary: 'Update a monitor. Changing `config` or `ignorePaths` resets the learned baseline.',
          params: IdParams,
          body: Type.Partial(Type.Object(common), { additionalProperties: false }),
          response: { 200: Type.Object({ monitor: Monitor }), ...errors(400, 401, 403, 404) },
        },
      },
      async (req) => ({ monitor: (await updateMonitor(ctx, req.params.id, req.body as never, actorOf(req))) as never }),
    );

    app.delete(
      '/monitors/:id',
      {
        config: editor,
        schema: {
          tags,
          summary: 'Delete a monitor and all its history',
          params: IdParams,
          response: { 204: Type.Null(), ...errors(401, 403, 404) },
        },
      },
      async (req, reply) => {
        await deleteMonitor(ctx, req.params.id, actorOf(req));
        return reply.status(204).send(null);
      },
    );

    app.post(
      '/monitors/:id/run',
      {
        config: { ...editor, rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: 'Run a check now and record it',
          params: IdParams,
          response: { 200: RunSummary, ...errors(401, 403, 404, 429) },
        },
      },
      async (req) => {
        const row = await getMonitorRow(ctx, req.params.id);
        return (await runMonitor(ctx, row)) as never;
      },
    );

    app.get(
      '/monitors/:id/results',
      {
        config: viewer,
        schema: {
          tags,
          summary: 'Check results, newest first (cursor pagination by id)',
          params: IdParams,
          querystring: Type.Object({
            limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
            before: Type.Optional(Type.Integer({ minimum: 1 })),
          }),
          response: { 200: Type.Object({ results: Type.Array(CheckResult) }), ...errors(401, 404) },
        },
      },
      async (req) => ({
        results: (await listResults(ctx, req.params.id, { limit: req.query.limit ?? 50, before: req.query.before })) as never,
      }),
    );

    app.get(
      '/monitors/:id/baseline',
      {
        config: viewer,
        schema: { tags, summary: 'The learned structural baseline', params: IdParams, response: { 200: Baseline, ...errors(401, 404) } },
      },
      async (req) => (await getBaseline(ctx, req.params.id)) as never,
    );

    app.delete(
      '/monitors/:id/baseline',
      {
        config: editor,
        schema: {
          tags,
          summary: 'Forget the baseline and relearn it from the next checks',
          params: IdParams,
          response: { 204: Type.Null(), ...errors(401, 403, 404) },
        },
      },
      async (req, reply) => {
        await resetBaseline(ctx, req.params.id, actorOf(req));
        return reply.status(204).send(null);
      },
    );
  };
