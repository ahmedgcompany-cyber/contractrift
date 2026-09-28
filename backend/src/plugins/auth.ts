import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { resolveSession, type UserRow } from '../services/auth.js';
import type { Actor, Ctx } from '../services/context.js';
import { resolveToken } from '../services/tokens.js';

export const SESSION_COOKIE = 'tripline_session';
export const CSRF_HEADER = 'x-tripline-csrf';

export type Auth = { user: UserRow; via: 'session' | 'token'; sessionId: string | null };

declare module 'fastify' {
  interface FastifyRequest {
    auth: Auth | null;
  }
  interface FastifyContextConfig {
    /** Minimum role required; undefined = public route. */
    role?: 'viewer' | 'editor' | 'admin';
    /** Allowed even when the user must change their password first. */
    allowPasswordChangePending?: boolean;
  }
}

const RANK = { viewer: 0, editor: 1, admin: 2 } as const;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function actorOf(req: FastifyRequest): Actor {
  return { userId: req.auth?.user.id ?? null, ip: req.ip };
}

export function registerAuth(app: FastifyInstance, ctx: Ctx) {
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (!req.url.startsWith('/api/')) return;
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (bearer) {
      const user = await resolveToken(ctx, bearer);
      if (!user) throw new AppError('UNAUTHENTICATED', 'Invalid or expired API token.');
      if (UNSAFE.has(req.method)) throw new AppError('FORBIDDEN', 'API tokens are read-only.');
      req.auth = { user, via: 'token', sessionId: null };
      return;
    }

    // Cookie-authenticated (or anonymous) state-changing requests must prove same-origin intent.
    // A custom header cannot be set by cross-site forms, and CORS is not enabled for other origins.
    if (UNSAFE.has(req.method)) {
      if (req.headers[CSRF_HEADER] !== '1') throw new AppError('CSRF_REJECTED', `Missing ${CSRF_HEADER} header.`);
      const origin = req.headers.origin;
      if (origin && origin !== new URL(ctx.config.appUrl).origin) throw new AppError('CSRF_REJECTED', 'Cross-origin request rejected.');
    }

    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const resolved = await resolveSession(ctx, token);
      if (resolved) req.auth = { user: resolved.user, via: 'session', sessionId: resolved.sessionId };
    }
  });

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const cfg = req.routeOptions.config;
    if (!cfg?.role) return;
    if (!req.auth) throw new AppError('UNAUTHENTICATED', 'Sign in required.');
    if (RANK[req.auth.user.role] < RANK[cfg.role]) throw new AppError('FORBIDDEN', `This action requires the ${cfg.role} role.`);
    if (req.auth.user.mustChangePassword && req.auth.via === 'session' && !cfg.allowPasswordChangePending) {
      throw new AppError('PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing.');
    }
  });
}

export function setSessionCookie(reply: FastifyReply, ctx: Ctx, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, ctx: Ctx) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: ctx.config.cookieSecure, sameSite: 'lax' });
}
