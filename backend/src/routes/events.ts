import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { actorOf } from '../plugins/auth.js';
import type { Ctx } from '../services/context.js';
import { acceptDrift, dismissDrift, getDrift, listDrift } from '../services/drift.js';
import { listIncidents } from '../services/overview.js';
import { DriftEvent, DriftStatusSchema, errors, IdParams, Incident } from './schemas.js';

/** Drift events and incidents. */
export const eventRoutes =
  (ctx: Ctx): FastifyPluginAsyncTypebox =>
  async (app) => {
    const viewer = { role: 'viewer' as const };
    const editor = { role: 'editor' as const };
    const limit = Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 }));

    app.get(
      '/drift',
      {
        config: viewer,
        schema: {
          tags: ['drift'],
          summary: 'List drift events, newest first',
          querystring: Type.Object({
            status: Type.Optional(DriftStatusSchema),
            monitorId: Type.Optional(Type.String({ format: 'uuid' })),
            limit,
          }),
          response: { 200: Type.Object({ events: Type.Array(DriftEvent) }), ...errors(401) },
        },
      },
      async (req) => ({ events: (await listDrift(ctx, { ...req.query, limit: req.query.limit ?? 50 })) as never }),
    );

    app.get(
      '/drift/:id',
      {
        config: viewer,
        schema: {
          tags: ['drift'],
          summary: 'Get a drift event',
          params: IdParams,
          response: { 200: Type.Object({ event: DriftEvent }), ...errors(401, 404) },
        },
      },
      async (req) => ({ event: (await getDrift(ctx, req.params.id)) as never }),
    );

    app.post(
      '/drift/:id/accept',
      {
        config: editor,
        schema: {
          tags: ['drift'],
          summary: 'Accept: the observed structure becomes the baseline',
          params: IdParams,
          response: { 200: Type.Object({ event: DriftEvent }), ...errors(401, 403, 404, 409) },
        },
      },
      async (req) => ({ event: (await acceptDrift(ctx, req.params.id, actorOf(req))) as never }),
    );

    app.post(
      '/drift/:id/dismiss',
      {
        config: editor,
        schema: {
          tags: ['drift'],
          summary: 'Dismiss: mute this exact set of changes',
          params: IdParams,
          response: { 200: Type.Object({ event: DriftEvent }), ...errors(401, 403, 404, 409) },
        },
      },
      async (req) => ({ event: (await dismissDrift(ctx, req.params.id, actorOf(req))) as never }),
    );

    app.get(
      '/incidents',
      {
        config: viewer,
        schema: {
          tags: ['incidents'],
          summary: 'List incidents, newest first',
          querystring: Type.Object({
            status: Type.Optional(Type.Enum(['open', 'resolved'])),
            monitorId: Type.Optional(Type.String({ format: 'uuid' })),
            limit,
          }),
          response: { 200: Type.Object({ incidents: Type.Array(Incident) }), ...errors(401) },
        },
      },
      async (req) => ({ incidents: (await listIncidents(ctx, { ...req.query, limit: req.query.limit ?? 50 })) as never }),
    );
  };
