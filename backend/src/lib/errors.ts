export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CSRF_REJECTED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'SETUP_ALREADY_DONE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SETUP_ALREADY_DONE: 409,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/** An error whose message is safe to show to the API client. */
export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.statusCode = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found.`);
export const validation = (message: string, details?: unknown) => new AppError('VALIDATION_ERROR', message, details);
export const conflict = (message: string) => new AppError('CONFLICT', message);
