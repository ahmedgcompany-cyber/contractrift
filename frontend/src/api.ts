/** Thin typed client for the ContractRift API. Same-origin; session cookie + CSRF header. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') headers['x-contractrift-csrf'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the ContractRift server. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'HTTP_ERROR',
      e?.message ?? `Request failed (HTTP ${res.status}).`,
      e?.request_id,
      e?.details,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: (path: string) => request<void>('DELETE', path),
};

export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- Types mirroring api/openapi.yaml ----

export type Role = 'viewer' | 'editor' | 'admin';
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};
export type Kind = 'http' | 'llm' | 'mcp';
export type Status = 'unknown' | 'up' | 'down';
export type Severity = 'breaking' | 'warning' | 'info';
export type Assertion = { name: string; ok: boolean; message: string };

export type Monitor = {
  id: string;
  name: string;
  kind: Kind;
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  baselineSamples: number;
  driftEnabled: boolean;
  ignorePaths: string[];
  tags: string[];
  config: Record<string, unknown>;
  secretKeys: { headers: string[]; query: string[]; apiKey: boolean };
  status: Status;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
};
export type MonitorListItem = Monitor & { recent: { d: number; ok: boolean }[]; openDrift: { open: number; worst: Severity | null } };

export type CheckResult = {
  id: number;
  monitorId: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
  statusCode: number | null;
  errorCode: string | null;
  message: string | null;
  assertions: Assertion[];
  meta: Record<string, unknown>;
  responseExcerpt: string | null;
};

export type DriftChange = { kind: string; path: string; severity: Severity; before?: string; after?: string; message: string };
export type DriftEvent = {
  id: string;
  monitorId: string;
  monitorName: string;
  monitorKind: Kind;
  detectedAt: string;
  lastSeenAt: string;
  occurrences: number;
  severity: Severity;
  changes: DriftChange[];
  status: 'open' | 'accepted' | 'dismissed';
  decidedAt: string | null;
};

export type Incident = {
  id: string;
  monitorId: string;
  monitorName: string;
  openedAt: string;
  resolvedAt: string | null;
  cause: string;
  lastError: string | null;
  failureCount: number;
};

export type Baseline = {
  state: 'none' | 'learning' | 'locked';
  samples: number;
  samplesRequired: number;
  lockedAt: string | null;
  paths: { path: string; types: string[]; required: boolean; emptyArray: boolean }[];
  truncated: boolean;
  signature: Record<string, { value: string; severity: Severity; label: string }>;
};

export type RunSummary = {
  result: CheckResult;
  status: Status;
  incident: 'opened' | 'resolved' | 'ongoing' | null;
  baseline: 'learning' | 'locked' | 'disabled' | 'skipped';
  drift: { eventId: string; severity: Severity; isNew: boolean; changes: number } | null;
};

export type DryRun = {
  ok: boolean;
  statusCode?: number;
  durationMs: number;
  errorCode?: string;
  message: string;
  assertions: Assertion[];
  meta: Record<string, unknown>;
  excerpt?: string;
  observedPaths: number;
};

export type EventType = 'incident.opened' | 'incident.resolved' | 'drift.breaking' | 'drift.warning' | 'drift.info';
export type Channel = {
  id: string;
  name: string;
  kind: 'webhook' | 'slack';
  enabled: boolean;
  events: EventType[];
  target: string;
  hasSecret: boolean;
  createdAt: string;
};
export type Delivery = {
  id: string;
  eventType: string;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  responseStatus: number | null;
  createdAt: string;
  sentAt: string | null;
};
export type ApiToken = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null };
export type AuditEntry = {
  id: number;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  userEmail: string | null;
};
export type Summary = {
  monitors: { total: number; up: number; down: number; unknown: number; paused: number };
  needsAttention: number;
  openIncidents: number;
  openDrift: { breaking: number; warning: number; info: number };
  checksLast24h: { total: number; failed: number };
};

export type MonitorPage = { monitors: MonitorListItem[]; total: number; limit: number; offset: number };
