import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { AppError } from '../lib/errors.js';
import { actorOf } from '../plugins/auth.js';
import { isDemoUser } from '../services/demo.js';
import { PASSWORD_MAX, PASSWORD_MIN } from '../services/auth.js';
import type { Ctx } from '../services/context.js';
import { createToken, listTokens, revokeToken } from '../services/tokens.js';
import { createUser, deleteUser, listUsers, resetPassword, updateUser } from '../services/users.js';
import { ApiToken, errors, IdParams, Role, User } from './schemas.js';

export const userRoutes =
  (ctx: Ctx): FastifyPluginAsyncTypebox =>
  async (app) => {
    const tags = ['users'];
    const admin = { role: 'admin' as const };

    app.get(
      '/users',
      {
        config: admin,
        schema: { tags, summary: 'List users', response: { 200: Type.Object({ users: Type.Array(User) }), ...errors(401, 403) } },
      },
      async () => ({
        users: await listUsers(ctx),
      }),
    );

    app.post(
      '/users',
      {
        config: admin,
        schema: {
          tags,
          summary: 'Create a user with an initial password (they must change it at first sign-in)',
          body: Type.Object(
            {
              email: Type.String({ format: 'email', maxLength: 254 }),
              name: Type.String({ minLength: 1, maxLength: 120 }),
              role: Role,
              password: Type.String({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX }),
            },
            { additionalProperties: false },
          ),
          response: { 201: Type.Object({ user: User }), ...errors(400, 401, 403, 409) },
        },
      },
      async (req, reply) => reply.status(201).send({ user: await createUser(ctx, req.body, actorOf(req)) }),
    );

    app.patch(
      '/users/:id',
      {
        config: admin,
        schema: {
          tags,
          summary: 'Update name, role or disabled flag',
          params: IdParams,
          body: Type.Object(
            {
              name: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
              role: Type.Optional(Role),
              disabled: Type.Optional(Type.Boolean()),
            },
            { additionalProperties: false },
          ),
          response: { 200: Type.Object({ user: User }), ...errors(400, 401, 403, 404, 409) },
        },
      },
      async (req) => ({ user: await updateUser(ctx, req.params.id, req.body, actorOf(req)) }),
    );

    app.post(
      '/users/:id/reset-password',
      {
        config: admin,
        schema: {
          tags,
          summary: 'Set a random temporary password (returned once) and sign the user out everywhere',
          params: IdParams,
          response: { 200: Type.Object({ temporaryPassword: Type.String() }), ...errors(401, 403, 404) },
        },
      },
      async (req) => resetPassword(ctx, req.params.id, actorOf(req)),
    );

    app.delete(
      '/users/:id',
      {
        config: admin,
        schema: { tags, summary: 'Delete a user', params: IdParams, response: { 204: Type.Null(), ...errors(401, 403, 404, 409) } },
      },
      async (req, reply) => {
        await deleteUser(ctx, req.params.id, actorOf(req));
        return reply.status(204).send(null);
      },
    );

    // Personal API tokens (read-only), scoped to the current user.
    const ttags = ['tokens'];
    app.get(
      '/tokens',
      {
        config: { role: 'viewer' },
        schema: {
          tags: ttags,
          summary: 'List my API tokens',
          response: { 200: Type.Object({ tokens: Type.Array(ApiToken) }), ...errors(401) },
        },
      },
      async (req) => ({
        tokens: await listTokens(ctx, req.auth!.user.id),
      }),
    );

    app.post(
      '/tokens',
      {
        config: { role: 'viewer' },
        schema: {
          tags: ttags,
          summary: 'Create a read-only API token; the token value is returned only in this response',
          body: Type.Object(
            {
              name: Type.String({ minLength: 1, maxLength: 80 }),
              expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
            },
            { additionalProperties: false },
          ),
          response: { 201: Type.Object({ token: Type.String(), apiToken: ApiToken }), ...errors(400, 401, 403) },
        },
      },
      async (req, reply) => {
        if (isDemoUser(ctx, req.auth!.user)) throw new AppError('FORBIDDEN', 'The shared demo account cannot create API tokens.');
        const { token, ...apiToken } = await createToken(ctx, req.auth!.user.id, req.body, actorOf(req));
        return reply.status(201).send({ token, apiToken: apiToken as never });
      },
    );

    app.delete(
      '/tokens/:id',
      {
        config: { role: 'viewer' },
        schema: {
          tags: ttags,
          summary: 'Revoke one of my API tokens',
          params: IdParams,
          response: { 204: Type.Null(), ...errors(401, 403, 404) },
        },
      },
      async (req, reply) => {
        await revokeToken(ctx, req.auth!.user.id, req.params.id, actorOf(req));
        return reply.status(204).send(null);
      },
    );
  };
