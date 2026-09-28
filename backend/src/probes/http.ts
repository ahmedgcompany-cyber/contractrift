import type { AssertionResultRow } from '../db/schema.js';
import { OutboundError, outboundRequest } from '../lib/http-client.js';
import { evaluateJsonPathAssertion, schemaAssertion } from './assertions.js';
import type { HttpConfig, ProbeSecrets } from './config.js';
import { type ProbeContext, type ProbeOutcome, redactExcerpt, summarize } from './types.js';

export function statusAccepted(status: number, expected: readonly number[]): boolean {
  return expected.length === 0 ? status >= 200 && status < 300 : expected.includes(status);
}

export function secretValues(secrets: ProbeSecrets): string[] {
  return [...Object.values(secrets.headers ?? {}), ...Object.values(secrets.query ?? {}), ...(secrets.apiKey ? [secrets.apiKey] : [])];
}

/** Adds secret query parameters to a URL at request time; they are never stored in `config.url`. */
export function withSecretQuery(url: string, secrets: ProbeSecrets): string {
  const entries = Object.entries(secrets.query ?? {});
  if (!entries.length) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of entries) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    return url; // invalid URL: let the request layer report INVALID_URL
  }
}

export function failureFromError(err: unknown, durationMs: number): ProbeOutcome {
  const e = err instanceof OutboundError ? err : new OutboundError('NETWORK', (err as Error).message);
  return {
    ok: false,
    durationMs,
    errorCode: e.code,
    message: e.message,
    assertions: [{ name: 'request', ok: false, message: e.message }],
    signature: {},
    meta: {},
  };
}

export async function runHttpProbe(cfg: HttpConfig, secrets: ProbeSecrets, ctx: ProbeContext): Promise<ProbeOutcome> {
  const headers: Record<string, string> = { ...cfg.headers, ...secrets.headers };
  const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
  if (cfg.body !== undefined && !hasContentType) {
    headers['content-type'] = cfg.body.trim().startsWith('{') || cfg.body.trim().startsWith('[') ? 'application/json' : 'text/plain';
  }
  if (!Object.keys(headers).some((h) => h.toLowerCase() === 'accept')) headers.accept = 'application/json, */*;q=0.5';

  const started = performance.now();
  let res: Awaited<ReturnType<typeof outboundRequest>>;
  try {
    res = await outboundRequest({
      url: withSecretQuery(cfg.url, secrets),
      method: cfg.method,
      headers,
      body: cfg.method === 'GET' || cfg.method === 'HEAD' ? undefined : cfg.body,
      timeoutMs: ctx.timeoutMs,
      allowPrivate: ctx.allowPrivateTargets,
      followRedirects: cfg.followRedirects,
    });
  } catch (err) {
    return failureFromError(err, Math.round(performance.now() - started));
  }

  const assertions: AssertionResultRow[] = [];
  const statusOk = statusAccepted(res.status, cfg.expectedStatus);
  assertions.push({
    name: 'status',
    ok: statusOk,
    message: statusOk
      ? `HTTP ${res.status}.`
      : `HTTP ${res.status}; expected ${cfg.expectedStatus.length ? cfg.expectedStatus.join(', ') : '2xx'}.`,
  });
  if (cfg.maxLatencyMs !== undefined) {
    const ok = res.durationMs <= cfg.maxLatencyMs;
    assertions.push({ name: 'latency', ok, message: `${res.durationMs} ms (limit ${cfg.maxLatencyMs} ms).` });
  }

  let json: unknown;
  let isJson = false;
  const contentType = res.headers['content-type'] ?? '';
  if (res.body.length > 0 && (contentType.includes('json') || /^\s*[[{]/.test(res.body))) {
    try {
      json = JSON.parse(res.body);
      isJson = true;
    } catch {
      if (contentType.includes('json')) assertions.push({ name: 'json', ok: false, message: 'Response declared JSON but did not parse.' });
    }
  }

  const needsJson = cfg.assertions.length > 0 || cfg.jsonSchema !== undefined;
  if (needsJson && !isJson) {
    assertions.push({ name: 'json', ok: false, message: 'Response body is not JSON; JSON assertions could not run.' });
  } else if (isJson) {
    for (const a of cfg.assertions) assertions.push(evaluateJsonPathAssertion(json, a));
    if (cfg.jsonSchema) assertions.push(schemaAssertion('body matches JSON Schema', cfg.jsonSchema, json));
  }

  const { ok, message } = summarize(assertions);
  const failed = assertions.filter((a) => !a.ok);
  const errorCode = ok ? undefined : !statusOk ? 'HTTP_STATUS' : failed.every((a) => a.name === 'latency') ? 'LATENCY' : 'ASSERTION';
  return {
    ok,
    statusCode: res.status,
    durationMs: res.durationMs,
    errorCode,
    message,
    assertions,
    // Drift is only meaningful for a "normal" response; error bodies have their own shapes.
    observed: statusOk && isJson ? json : undefined,
    signature: {},
    meta: { contentType, bytes: Buffer.byteLength(res.body) },
    excerpt: ok ? undefined : redactExcerpt(res.body, secretValues(secrets)),
  };
}
