import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import { isDemoUser } from '../services/demo.js';
import { actorOf, clearSessionCookie, setSessionCookie } from '../plugins/auth.js';
import { changePassword, createSession, login, logout, needsSetup, PASSWORD_MAX, setupFirstAdmin, toPublicUser } from '../services/auth.js';
import type { Ctx } from '../services/context.js';
import { errors, User } from './schemas.js';

const Email = Type.String({ format: 'email', maxLength: 254 });
const Password = Type.String({ minLength: 1, maxLength: PASSWORD_MAX });
const tags = ['auth'];

export const authRoutes =
  (ctx: Ctx): FastifyPluginAsyncTypebox =>
  async (app) => {
    app.get(
      '/auth/setup-status',
      {
        schema: {
          tags,
          summary: 'Whether first-run setup is still required',
          response: {
            200: Type.Object({
              needsSetup: Type.Boolean(),
              setupTokenRequired: Type.Boolean(),
              demo: Type.Optional(Type.Object({ email: Type.String(), password: Type.String() })),
            }),
          },
        },
      },
      async () => ({
        needsSetup: await needsSetup(ctx),
        setupTokenRequired: !!ctx.config.setupToken,
        ...(ctx.config.demoMode ? { demo: { email: ctx.config.demoEmail, password: ctx.config.demoPassword } } : {}),
      }),
    );

    app.post(
      '/auth/setup',
      {
        config: { rateLimit: { max: ctx.config.authRateLimitPerMinute, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: 'Create the first administrator (only while no users exist) and sign in',
          body: Type.Object(
            {
              email: Email,
              name: Type.String({ minLength: 1, maxLength: 120 }),
              password: Password,
              setupToken: Type.Optional(Type.String({ maxLength: 512 })),
            },
            { additionalProperties: false },
          ),
          response: { 201: Type.Object({ user: User }), ...errors(400, 403, 409, 429) },
        },
      },
      async (req, reply) => {
        if (ctx.config.setupToken && !safeEqual(req.body.setupToken ?? '', ctx.config.setupToken)) {
          throw new AppError('FORBIDDEN', 'A valid setup token is required. It is set by SETUP_TOKEN on the server.');
        }
        const user = await setupFirstAdmin(ctx, { email: req.body.email, name: req.body.name, password: req.body.password }, req.ip);
        const session = await createSession(ctx, user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
        setSessionCookie(reply, ctx, session.token, session.expiresAt);
        return reply.status(201).send({ user: toPublicUser(user) });
      },
    );

    app.post(
      '/auth/login',
      {
        config: { rateLimit: { max: ctx.config.authRateLimitPerMinute, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: 'Sign in with email and password; sets the session cookie',
          body: Type.Object({ email: Type.String({ maxLength: 254 }), password: Password }, { additionalProperties: false }),
          response: { 200: Type.Object({ user: User }), ...errors(400, 401, 403, 423, 429) },
        },
      },
      async (req, reply) => {
        const res = await login(ctx, { ...req.body, ip: req.ip, userAgent: req.headers['user-agent'] });
        setSessionCookie(reply, ctx, res.token, res.expiresAt);
        return { user: res.user };
      },
    );

    app.post(
      '/auth/logout',
      {
        config: { role: 'viewer', allowPasswordChangePending: true },
        schema: { tags, summary: 'Sign out (deletes the session)', response: { 204: Type.Null(), ...errors(401, 403) } },
      },
      async (req, reply) => {
        if (req.auth?.sessionId) await logout(ctx, req.auth.sessionId, actorOf(req));
        clearSessionCookie(reply, ctx);
        return reply.status(204).send(null);
      },
    );

    app.get(
      '/auth/me',
      {
        config: { role: 'viewer', allowPasswordChangePending: true },
        schema: {
          tags,
          summary: 'Current user',
          response: { 200: Type.Object({ user: User, via: Type.Enum(['session', 'token']) }), ...errors(401) },
        },
      },
      async (req) => ({ user: toPublicUser(req.auth!.user), via: req.auth!.via }),
    );

    app.post(
      '/auth/change-password',
      {
        config: {
          role: 'viewer',
          allowPasswordChangePending: true,
          rateLimit: { max: ctx.config.authRateLimitPerMinute, timeWindow: '1 minute' },
        },
        schema: {
          tags,
          summary: 'Change own password; signs out all other sessions',
          body: Type.Object({ currentPassword: Password, newPassword: Password }, { additionalProperties: false }),
          response: { 204: Type.Null(), ...errors(400, 401, 403, 429) },
        },
      },
      async (req, reply) => {
        if (req.auth!.via !== 'session') throw new AppError('FORBIDDEN', 'Password changes require a browser session.');
        if (isDemoUser(ctx, req.auth!.user)) throw new AppError('FORBIDDEN', 'The shared demo account cannot change its password.');
        await changePassword(ctx, req.auth!.user, req.auth!.sessionId, req.body.currentPassword, req.body.newPassword, actorOf(req));
        return reply.status(204).send(null);
      },
    );
  };
