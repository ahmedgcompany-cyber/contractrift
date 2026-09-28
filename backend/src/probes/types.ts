import type { AssertionResultRow } from '../db/schema.js';
import type { Signature } from '../drift/types.js';

export type ProbeContext = {
  timeoutMs: number;
  allowPrivateTargets: boolean;
};

export type ProbeOutcome = {
  ok: boolean;
  statusCode?: number | undefined;
  durationMs: number;
  /** Stable machine-readable failure reason, e.g. TIMEOUT, HTTP_STATUS, ASSERTION, PROTOCOL. */
  errorCode?: string | undefined;
  message: string;
  assertions: AssertionResultRow[];
  /** JSON document used for structural drift detection; absent when drift must not be evaluated. */
  observed?: unknown;
  signature: Signature;
  meta: Record<string, unknown>;
  /** Short, redacted response excerpt (failures only). */
  excerpt?: string | undefined;
};

export const EXCERPT_LIMIT = 2048;

/** Removes any secret values echoed back by the upstream, then truncates. */
export function redactExcerpt(body: string, secrets: readonly string[]): string {
  let out = body.slice(0, EXCERPT_LIMIT * 2);
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('[REDACTED]');
  return out.slice(0, EXCERPT_LIMIT);
}

export function summarize(assertions: AssertionResultRow[]): { ok: boolean; message: string } {
  const failed = assertions.filter((a) => !a.ok);
  if (failed.length === 0) return { ok: true, message: `All ${assertions.length} checks passed.` };
  const first = failed[0];
  return {
    ok: false,
    message: `${failed.length} of ${assertions.length} checks failed. First: ${first?.name} — ${first?.message}`,
  };
}
