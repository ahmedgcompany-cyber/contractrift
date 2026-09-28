import type { AssertionResultRow } from '../db/schema.js';
import type { Signature } from '../drift/types.js';
import { outboundRequest } from '../lib/http-client.js';
import { evaluateTextAssertion } from './assertions.js';
import type { LlmConfig, ProbeSecrets } from './config.js';
import { failureFromError, secretValues } from './http.js';
import { type ProbeContext, type ProbeOutcome, redactExcerpt, summarize } from './types.js';

export const DEFAULT_BASE_URL = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com' } as const;
export const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

type Built = { url: string; headers: Record<string, string>; body: string };

export function buildLlmRequest(cfg: LlmConfig, secrets: ProbeSecrets): Built {
  const base = (cfg.baseUrl ?? DEFAULT_BASE_URL[cfg.provider]).replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...cfg.headers,
    ...secrets.headers,
  };
  if (cfg.provider === 'openai') {
    if (secrets.apiKey) headers.authorization = `Bearer ${secrets.apiKey}`;
    const messages = [...(cfg.system ? [{ role: 'system', content: cfg.system }] : []), { role: 'user', content: cfg.prompt }];
    return {
      url: `${base}/chat/completions`,
      headers,
      body: JSON.stringify({ model: cfg.model, messages, max_tokens: cfg.maxTokens, temperature: cfg.temperature }),
    };
  }
  if (secrets.apiKey) headers['x-api-key'] = secrets.apiKey;
  headers['anthropic-version'] = cfg.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION;
  return {
    url: `${base}/v1/messages`,
    headers,
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      ...(cfg.system ? { system: cfg.system } : {}),
      messages: [{ role: 'user', content: cfg.prompt }],
    }),
  };
}

type Extracted = { text: string | null; model: string | null; usage: Record<string, unknown> | null; finish: string | null };

/** Extracts output text and metadata leniently; format changes surface as a PROTOCOL failure. */
export function extractLlmOutput(provider: LlmConfig['provider'], body: unknown): Extracted {
  const b = (body ?? {}) as Record<string, unknown>;
  const model = typeof b.model === 'string' ? b.model : null;
  const usage = b.usage && typeof b.usage === 'object' ? (b.usage as Record<string, unknown>) : null;
  if (provider === 'openai') {
    const choice = Array.isArray(b.choices) ? (b.choices[0] as Record<string, unknown> | undefined) : undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    const content = message?.content;
    let text: string | null = null;
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      text = content
        .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
        .join('');
    }
    return { text, model, usage, finish: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null };
  }
  const content = Array.isArray(b.content) ? b.content : null;
  const text = content
    ? content
        .filter((p): p is { type: string; text: string } => !!p && typeof p === 'object' && (p as { type?: unknown }).type === 'text')
        .map((p) => p.text)
        .join('')
    : null;
  return { text, model, usage, finish: typeof b.stop_reason === 'string' ? b.stop_reason : null };
}

function providerError(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; type?: unknown } | string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message;
  } catch {
    /* not JSON */
  }
  return null;
}

export async function runLlmProbe(cfg: LlmConfig, secrets: ProbeSecrets, ctx: ProbeContext): Promise<ProbeOutcome> {
  const req = buildLlmRequest(cfg, secrets);
  const started = performance.now();
  let res: Awaited<ReturnType<typeof outboundRequest>>;
  try {
    res = await outboundRequest({
      url: req.url,
      method: 'POST',
      headers: req.headers,
      body: req.body,
      timeoutMs: ctx.timeoutMs,
      allowPrivate: ctx.allowPrivateTargets,
    });
  } catch (err) {
    return failureFromError(err, Math.round(performance.now() - started));
  }
  const secretsList = secretValues(secrets);
  const base = { statusCode: res.status, durationMs: res.durationMs, signature: {} as Signature };

  if (res.status < 200 || res.status >= 300) {
    const detail = providerError(res.body);
    const auth = res.status === 401 || res.status === 403;
    const message = `Provider returned HTTP ${res.status}${detail ? `: ${redactExcerpt(detail, secretsList).slice(0, 300)}` : '.'}`;
    return {
      ...base,
      ok: false,
      errorCode: auth ? 'AUTH' : res.status === 429 ? 'RATE_LIMITED' : 'HTTP_STATUS',
      message,
      assertions: [{ name: 'status', ok: false, message }],
      meta: {},
      excerpt: redactExcerpt(res.body, secretsList),
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    const message = 'Provider response is not JSON.';
    return {
      ...base,
      ok: false,
      errorCode: 'PROTOCOL',
      message,
      assertions: [{ name: 'json', ok: false, message }],
      meta: {},
      excerpt: redactExcerpt(res.body, secretsList),
    };
  }

  const out = extractLlmOutput(cfg.provider, json);
  const assertions: AssertionResultRow[] = [{ name: 'status', ok: true, message: `HTTP ${res.status}.` }];
  if (out.text === null) {
    assertions.push({ name: 'output text', ok: false, message: 'Could not find output text in the response (format changed?).' });
  } else {
    assertions.push({ name: 'output text', ok: true, message: `${out.text.length} characters.` });
    for (const a of cfg.textAssertions) assertions.push(evaluateTextAssertion(out.text, a));
  }
  if (cfg.maxLatencyMs !== undefined) {
    assertions.push({
      name: 'latency',
      ok: res.durationMs <= cfg.maxLatencyMs,
      message: `${res.durationMs} ms (limit ${cfg.maxLatencyMs} ms).`,
    });
  }

  const signature: Signature = {};
  if (out.model) signature.model = { value: out.model, severity: 'warning', label: 'Model reported by the provider' };
  const { ok, message } = summarize(assertions);
  return {
    ...base,
    ok,
    errorCode: ok ? undefined : out.text === null ? 'PROTOCOL' : 'ASSERTION',
    message,
    assertions,
    observed: json,
    signature,
    meta: {
      requestedModel: cfg.model,
      reportedModel: out.model,
      finishReason: out.finish,
      usage: out.usage,
      outputPreview: out.text === null ? null : out.text.slice(0, 200),
    },
    excerpt: ok ? undefined : redactExcerpt(res.body, secretsList),
  };
}
