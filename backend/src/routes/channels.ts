import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { actorOf } from '../plugins/auth.js';
import type { Ctx } from '../services/context.js';
import { createChannel, deleteChannel, listChannels, listDeliveries, testChannel, updateChannel } from '../services/notifications.js';
import { Channel, Delivery, errors, EventTypeSchema, IdParams, Nullable } from './schemas.js';

export const channelRoutes =
  (ctx: Ctx): FastifyPluginAsyncTypebox =>
  async (app) => {
    const tags = ['channels'];
    const admin = { role: 'admin' as const };
    const Url = Type.String({ minLength: 8, maxLength: 2048, pattern: '^https?://', description: 'Write-only; stored encrypted.' });
    const Secret = Type.String({ minLength: 8, maxLength: 256, description: 'HMAC-SHA256 signing secret (webhooks). Write-only.' });
    const Events = Type.Array(EventTypeSchema, { minItems: 1, maxItems: 5, uniqueItems: true });

    app.get(
      '/channels',
      {
        config: admin,
        schema: {
          tags,
          summary: 'List notification channels',
          response: { 200: Type.Object({ channels: Type.Array(Channel) }), ...errors(401, 403) },
        },
      },
      async () => ({
        channels: (await listChannels(ctx)) as never,
      }),
    );

    app.post(
      '/channels',
      {
        config: admin,
        schema: {
          tags,
          summary: 'Create a webhook or Slack channel',
          body: Type.Object(
            {
              name: Type.String({ minLength: 1, maxLength: 120 }),
              kind: Type.Enum(['webhook', 'slack']),
              url: Url,
              secret: Type.Optional(Secret),
              events: Type.Optional(Events),
              enabled: Type.Optional(Type.Boolean()),
            },
            { additionalProperties: false },
          ),
          response: { 201: Type.Object({ channel: Channel }), ...errors(400, 401, 403) },
        },
      },
      async (req, reply) => reply.status(201).send({ channel: (await createChannel(ctx, req.body as never, actorOf(req))) as never }),
    );

    app.patch(
      '/channels/:id',
      {
        config: admin,
        schema: {
          tags,
          summary: 'Update a channel (`secret: null` removes the signing secret)',
          params: IdParams,
          body: Type.Object(
            {
              name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
              url: Type.Optional(Url),
              secret: Type.Optional(Nullable(Secret)),
              events: Type.Optional(Events),
              enabled: Type.Optional(Type.Boolean()),
            },
            { additionalProperties: false },
          ),
          response: { 200: Type.Object({ channel: Channel }), ...errors(400, 401, 403, 404) },
        },
      },
      async (req) => ({ channel: (await updateChannel(ctx, req.params.id, req.body as never, actorOf(req))) as never }),
    );

    app.delete(
      '/channels/:id',
      {
        config: admin,
        schema: { tags, summary: 'Delete a channel', params: IdParams, response: { 204: Type.Null(), ...errors(401, 403, 404) } },
      },
      async (req, reply) => {
        await deleteChannel(ctx, req.params.id, actorOf(req));
        return reply.status(204).send(null);
      },
    );

    app.post(
      '/channels/:id/test',
      {
        config: { ...admin, rateLimit: { max: 10, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: 'Send a test notification synchronously',
          params: IdParams,
          response: {
            200: Type.Object({ ok: Type.Boolean(), status: Type.Optional(Type.Integer()), error: Type.Optional(Type.String()) }),
            ...errors(401, 403, 404, 429),
          },
        },
      },
      async (req) => testChannel(ctx, req.params.id, actorOf(req)),
    );

    app.get(
      '/channels/:id/deliveries',
      {
        config: admin,
        schema: {
          tags,
          summary: 'Recent delivery attempts for a channel',
          params: IdParams,
          querystring: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })) }),
          response: { 200: Type.Object({ deliveries: Type.Array(Delivery) }), ...errors(401, 403) },
        },
      },
      async (req) => ({ deliveries: (await listDeliveries(ctx, req.params.id, req.query.limit ?? 50)) as never }),
    );
  };
