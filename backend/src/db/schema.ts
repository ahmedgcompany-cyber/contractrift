import { sql } from 'drizzle-orm';
import { bigserial, boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { DriftChange, Shape, Signature } from '../drift/types.js';

export const userRole = pgEnum('user_role', ['viewer', 'editor', 'admin']);
export const monitorKind = pgEnum('monitor_kind', ['http', 'llm', 'mcp']);
export const monitorStatus = pgEnum('monitor_status', ['unknown', 'up', 'down']);
export const severity = pgEnum('drift_severity', ['breaking', 'warning', 'info']);
export const driftStatus = pgEnum('drift_status', ['open', 'accepted', 'dismissed']);
export const channelKind = pgEnum('channel_kind', ['webhook', 'slack']);
export const deliveryStatus = pgEnum('delivery_status', ['pending', 'sent', 'failed']);

const ts = (name?: string) => (name ? timestamp(name, { withTimezone: true }) : timestamp({ withTimezone: true }));
const createdAt = () => ts().notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    role: userRole().notNull().default('viewer'),
    disabled: boolean().notNull().default(false),
    mustChangePassword: boolean().notNull().default(false),
    failedLoginCount: integer().notNull().default(0),
    lockedUntil: ts(),
    lastLoginAt: ts(),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 hex of the session token; the token itself is never stored. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: createdAt(),
    expiresAt: ts().notNull(),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** SHA-256 hex of the token. */
    tokenHash: text().notNull(),
    /** First characters of the token, shown in the UI to identify it. */
    prefix: text().notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts(),
    expiresAt: ts(),
    revokedAt: ts(),
  },
  (t) => [uniqueIndex('api_tokens_hash_idx').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
);

export const monitors = pgTable(
  'monitors',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    kind: monitorKind().notNull(),
    enabled: boolean().notNull().default(true),
    intervalSeconds: integer().notNull().default(300),
    timeoutMs: integer().notNull().default(10_000),
    failureThreshold: integer().notNull().default(2),
    baselineSamples: integer().notNull().default(3),
    driftEnabled: boolean().notNull().default(true),
    ignorePaths: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Kind-specific, non-secret configuration (validated by the service layer). */
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    /** AES-256-GCM encrypted JSON of secret values (headers, API keys). Never returned by the API. */
    secretsEnc: text(),
    status: monitorStatus().notNull().default('unknown'),
    consecutiveFailures: integer().notNull().default(0),
    lastCheckedAt: ts(),
    lastDurationMs: integer(),
    lastError: text(),
    nextRunAt: ts().notNull().defaultNow(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index('monitors_due_idx')
      .on(t.nextRunAt)
      .where(sql`${t.enabled}`),
    index('monitors_status_idx').on(t.status),
  ],
);

export const baselines = pgTable('baselines', {
  monitorId: uuid()
    .primaryKey()
    .references(() => monitors.id, { onDelete: 'cascade' }),
  shape: jsonb().$type<Shape>().notNull(),
  signature: jsonb().$type<Signature>().notNull(),
  /** Set once `baselineSamples` observations have been merged; drift detection starts then. */
  lockedAt: ts(),
  updatedAt: createdAt(),
});

export const checkResults = pgTable(
  'check_results',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    monitorId: uuid()
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    startedAt: ts().notNull(),
    durationMs: integer().notNull(),
    ok: boolean().notNull(),
    statusCode: integer(),
    errorCode: text(),
    message: text(),
    assertions: jsonb().$type<AssertionResultRow[]>().notNull().default([]),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Short, redacted excerpt of the response body, stored only for failed checks. */
    responseExcerpt: text(),
  },
  (t) => [index('check_results_monitor_time_idx').on(t.monitorId, t.startedAt.desc()), index('check_results_time_idx').on(t.startedAt)],
);

export type AssertionResultRow = { name: string; ok: boolean; message: string };

export const incidents = pgTable(
  'incidents',
  {
    id: uuid().primaryKey().defaultRandom(),
    monitorId: uuid()
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    openedAt: ts().notNull().defaultNow(),
    resolvedAt: ts(),
    cause: text().notNull(),
    lastError: text(),
    failureCount: integer().notNull().default(0),
  },
  (t) => [
    index('incidents_monitor_idx').on(t.monitorId, t.openedAt.desc()),
    uniqueIndex('incidents_one_open_per_monitor')
      .on(t.monitorId)
      .where(sql`${t.resolvedAt} is null`),
  ],
);

export const driftEvents = pgTable(
  'drift_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    monitorId: uuid()
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    detectedAt: ts().notNull().defaultNow(),
    lastSeenAt: ts().notNull().defaultNow(),
    occurrences: integer().notNull().default(1),
    severity: severity().notNull(),
    fingerprint: text().notNull(),
    changes: jsonb().$type<DriftChange[]>().notNull(),
    /** Observation that triggered the event; used when the change is accepted. */
    observedShape: jsonb().$type<Shape>().notNull(),
    observedSignature: jsonb().$type<Signature>().notNull(),
    status: driftStatus().notNull().default('open'),
    decidedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts(),
  },
  (t) => [
    index('drift_events_monitor_idx').on(t.monitorId, t.detectedAt.desc()),
    index('drift_events_status_idx').on(t.status),
    index('drift_events_fingerprint_idx').on(t.monitorId, t.fingerprint),
  ],
);

export const notificationChannels = pgTable('notification_channels', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  kind: channelKind().notNull(),
  enabled: boolean().notNull().default(true),
  /** Event types this channel receives. */
  events: text().array().notNull(),
  /** Encrypted JSON: { url, secret? } — webhook URLs often embed credentials. */
  configEnc: text().notNull(),
  /** Non-secret display hint, e.g. the URL host. */
  target: text().notNull(),
  createdAt: createdAt(),
  updatedAt: createdAt(),
});

export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid().primaryKey().defaultRandom(),
    channelId: uuid()
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    eventType: text().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: deliveryStatus().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: ts().notNull().defaultNow(),
    lastError: text(),
    responseStatus: integer(),
    createdAt: createdAt(),
    sentAt: ts(),
  },
  (t) => [
    index('deliveries_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('deliveries_channel_idx').on(t.channelId, t.createdAt.desc()),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_time_idx').on(t.createdAt.desc())],
);
