import type { FastifyError, FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';

type ErrorBody = { error: { code: string; message: string; request_id: string; details?: unknown } };

export function registerErrorHandling(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError & { validation?: unknown[] }, req, reply) => {
    const body = (code: string, message: string, details?: unknown): ErrorBody => ({
      error: { code, message, request_id: String(req.id), ...(details === undefined ? {} : { details }) },
    });

    if (err instanceof AppError) {
      if (err.statusCode >= 500) req.log.error({ err }, 'application error');
      else req.log.info({ code: err.code }, 'request rejected');
      return reply.status(err.statusCode).send(body(err.code, err.message, err.details));
    }
    if (err.validation) {
      const details = (err.validation as { instancePath?: string; message?: string; params?: Record<string, unknown> }[]).map((v) => ({
        path: `${err.validationContext ?? ''}${v.instancePath ?? ''}${v.params?.missingProperty ? `/${String(v.params.missingProperty)}` : ''}${v.params?.additionalProperty ? `/${String(v.params.additionalProperty)}` : ''}`,
        message: v.message ?? 'is invalid',
      }));
      return reply.status(400).send(body('VALIDATION_ERROR', 'The request is invalid.', details));
    }
    if (err.statusCode === 429) {
      return reply.status(429).send(body('RATE_LIMITED', 'Too many requests. Please slow down.'));
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      // Framework-level client errors (bad JSON, payload too large, unsupported media type…).
      return reply.status(err.statusCode).send(body(err.statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL', 'An unexpected error occurred. Quote the request id when reporting it.'));
  });
}
