import { type TSchema, Type } from 'typebox';

/**
 * Response schemas. Fastify serializes responses with these, so only listed fields ever leave
 * the server — a second line of defence against leaking secrets — and they generate OpenAPI.
 */
export const Nullable = <T extends TSchema>(t: T) => Type.Union([t, Type.Null()]);
// Handlers return Date objects; the serializer emits ISO-8601 strings.
const DateTime = Type.Unsafe<Date | string>({ type: 'string', format: 'date-time' });
const NDate = Nullable(DateTime);
const Json = Type.Unknown();

export const Uuid = Type.String({ format: 'uuid' });
export const IdParams = Type.Object({ id: Uuid });

export const ErrorResponse = Type.Object(
  {
    error: Type.Object({
      code: Type.String(),
      message: Type.String(),
      request_id: Type.String(),
      details: Type.Optional(Json),
    }),
  },
  { $id: 'ErrorResponse' },
);

export const Role = Type.Enum(['viewer', 'editor', 'admin']);
export const MonitorKindSchema = Type.Enum(['http', 'llm', 'mcp']);
export const MonitorStatusSchema = Type.Enum(['unknown', 'up', 'down']);
export const SeveritySchema = Type.Enum(['breaking', 'warning', 'info']);
export const DriftStatusSchema = Type.Enum(['open', 'accepted', 'dismissed']);
export const EventTypeSchema = Type.Enum(['incident.opened', 'incident.resolved', 'drift.breaking', 'drift.warning', 'drift.info']);

export const User = Type.Object({
  id: Uuid,
  email: Type.String(),
  name: Type.String(),
  role: Role,
  disabled: Type.Boolean(),
  mustChangePassword: Type.Boolean(),
  lastLoginAt: NDate,
  createdAt: DateTime,
});

export const Assertion = Type.Object({ name: Type.String(), ok: Type.Boolean(), message: Type.String() });

export const Monitor = Type.Object({
  id: Uuid,
  name: Type.String(),
  kind: MonitorKindSchema,
  enabled: Type.Boolean(),
  intervalSeconds: Type.Integer(),
  timeoutMs: Type.Integer(),
  failureThreshold: Type.Integer(),
  baselineSamples: Type.Integer(),
  driftEnabled: Type.Boolean(),
  ignorePaths: Type.Array(Type.String()),
  tags: Type.Array(Type.String()),
  config: Type.Record(Type.String(), Json),
  secretKeys: Type.Object({ headers: Type.Array(Type.String()), query: Type.Array(Type.String()), apiKey: Type.Boolean() }),
  status: MonitorStatusSchema,
  consecutiveFailures: Type.Integer(),
  lastCheckedAt: NDate,
  lastDurationMs: Nullable(Type.Integer()),
  lastError: Nullable(Type.String()),
  nextRunAt: DateTime,
  createdBy: Nullable(Uuid),
  createdAt: DateTime,
  updatedAt: DateTime,
});

export const MonitorListItem = Type.Intersect([
  Monitor,
  Type.Object({
    recent: Type.Array(Type.Object({ d: Type.Integer(), ok: Type.Boolean() })),
    openDrift: Type.Object({ open: Type.Integer(), worst: Nullable(SeveritySchema) }),
  }),
]);

export const CheckResult = Type.Object({
  id: Type.Integer(),
  monitorId: Uuid,
  startedAt: DateTime,
  durationMs: Type.Integer(),
  ok: Type.Boolean(),
  statusCode: Nullable(Type.Integer()),
  errorCode: Nullable(Type.String()),
  message: Nullable(Type.String()),
  assertions: Type.Array(Assertion),
  meta: Type.Record(Type.String(), Json),
  responseExcerpt: Nullable(Type.String()),
});

export const DriftChange = Type.Object({
  kind: Type.String(),
  path: Type.String(),
  severity: SeveritySchema,
  before: Type.Optional(Type.String()),
  after: Type.Optional(Type.String()),
  message: Type.String(),
});

export const DriftEvent = Type.Object({
  id: Uuid,
  monitorId: Uuid,
  monitorName: Type.String(),
  monitorKind: MonitorKindSchema,
  detectedAt: DateTime,
  lastSeenAt: DateTime,
  occurrences: Type.Integer(),
  severity: SeveritySchema,
  changes: Type.Array(DriftChange),
  status: DriftStatusSchema,
  decidedBy: Nullable(Uuid),
  decidedAt: NDate,
});

export const Incident = Type.Object({
  id: Uuid,
  monitorId: Uuid,
  monitorName: Type.String(),
  openedAt: DateTime,
  resolvedAt: NDate,
  cause: Type.String(),
  lastError: Nullable(Type.String()),
  failureCount: Type.Integer(),
});

export const Baseline = Type.Object({
  monitorId: Uuid,
  state: Type.Enum(['none', 'learning', 'locked']),
  samples: Type.Integer(),
  samplesRequired: Type.Integer(),
  lockedAt: NDate,
  updatedAt: NDate,
  paths: Type.Array(
    Type.Object({ path: Type.String(), types: Type.Array(Type.String()), required: Type.Boolean(), emptyArray: Type.Boolean() }),
  ),
  truncated: Type.Boolean(),
  signature: Type.Record(Type.String(), Type.Object({ value: Type.String(), severity: SeveritySchema, label: Type.String() })),
});

export const RunSummary = Type.Object({
  result: CheckResult,
  status: MonitorStatusSchema,
  incident: Nullable(Type.Enum(['opened', 'resolved', 'ongoing'])),
  baseline: Type.Enum(['learning', 'locked', 'disabled', 'skipped']),
  drift: Nullable(Type.Object({ eventId: Type.String(), severity: SeveritySchema, isNew: Type.Boolean(), changes: Type.Integer() })),
});

export const DryRunResult = Type.Object({
  ok: Type.Boolean(),
  statusCode: Type.Optional(Type.Integer()),
  durationMs: Type.Integer(),
  errorCode: Type.Optional(Type.String()),
  message: Type.String(),
  assertions: Type.Array(Assertion),
  signature: Type.Record(Type.String(), Type.Object({ value: Type.String(), severity: SeveritySchema, label: Type.String() })),
  meta: Type.Record(Type.String(), Json),
  excerpt: Type.Optional(Type.String()),
  observedPaths: Type.Integer(),
});

export const Channel = Type.Object({
  id: Uuid,
  name: Type.String(),
  kind: Type.Enum(['webhook', 'slack']),
  enabled: Type.Boolean(),
  events: Type.Array(Type.String()),
  target: Type.String(),
  hasSecret: Type.Boolean(),
  createdAt: DateTime,
  updatedAt: DateTime,
});

export const Delivery = Type.Object({
  id: Uuid,
  channelId: Uuid,
  eventType: Type.String(),
  status: Type.Enum(['pending', 'sent', 'failed']),
  attempts: Type.Integer(),
  nextAttemptAt: DateTime,
  lastError: Nullable(Type.String()),
  responseStatus: Nullable(Type.Integer()),
  createdAt: DateTime,
  sentAt: NDate,
});

export const ApiToken = Type.Object({
  id: Uuid,
  name: Type.String(),
  prefix: Type.String(),
  createdAt: DateTime,
  lastUsedAt: NDate,
  expiresAt: NDate,
});

export const AuditEntry = Type.Object({
  id: Type.Integer(),
  action: Type.String(),
  targetType: Nullable(Type.String()),
  targetId: Nullable(Type.String()),
  details: Type.Record(Type.String(), Json),
  ip: Nullable(Type.String()),
  createdAt: DateTime,
  userId: Nullable(Uuid),
  userEmail: Nullable(Type.String()),
});

export const Summary = Type.Object({
  monitors: Type.Object({
    total: Type.Integer(),
    up: Type.Integer(),
    down: Type.Integer(),
    unknown: Type.Integer(),
    paused: Type.Integer(),
  }),
  needsAttention: Type.Integer({ description: 'Enabled monitors that are down or have open breaking drift' }),
  openIncidents: Type.Integer(),
  openDrift: Type.Object({ breaking: Type.Integer(), warning: Type.Integer(), info: Type.Integer() }),
  checksLast24h: Type.Object({ total: Type.Integer(), failed: Type.Integer() }),
});

export const Gate = Type.Object({
  pass: Type.Boolean(),
  evaluated: Type.Integer(),
  failOn: Type.Array(Type.String()),
  tags: Type.Array(Type.String()),
  failures: Type.Array(Type.Object({ monitorId: Uuid, name: Type.String(), reason: Type.String() })),
  evaluatedAt: DateTime,
});

/** Standard error responses for a route, referenced in OpenAPI. */
export const errors = (...codes: number[]) => Object.fromEntries(codes.map((c) => [c, Type.Ref('ErrorResponse')]));
