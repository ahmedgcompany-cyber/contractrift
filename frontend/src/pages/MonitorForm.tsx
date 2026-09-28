import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, api, type DryRun, type Kind, type Monitor } from '../api';
import { ErrorNote, Field, Loading, PageHead, Spinner, useToast } from '../components/ui';

type KV = { k: string; v: string };
type PathAssertion = { path: string; op: string; value: string };
type TextAssertion = { op: string; value: string };

type FormState = {
  name: string;
  kind: Kind;
  enabled: boolean;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  baselineSamples: number;
  driftEnabled: boolean;
  tags: string;
  ignorePaths: string;
  url: string;
  method: string;
  headers: KV[];
  body: string;
  expectedStatus: string;
  maxLatencyMs: string;
  followRedirects: boolean;
  assertions: PathAssertion[];
  jsonSchema: string;
  provider: 'openai' | 'anthropic';
  baseUrl: string;
  model: string;
  prompt: string;
  system: string;
  maxTokens: number;
  temperature: number;
  textAssertions: TextAssertion[];
  protocol: 'auto' | 'modern' | 'legacy';
  expectedTools: string;
  toolCall: boolean;
  toolName: string;
  toolArgs: string;
  expectText: string;
  // secrets (write-only)
  existingSecretHeaders: string[];
  removedSecretHeaders: string[];
  newSecretHeaders: KV[];
  hasApiKey: boolean;
  apiKey: string;
  clearApiKey: boolean;
};

const blank: FormState = {
  name: '',
  kind: 'http',
  enabled: true,
  intervalSeconds: 300,
  timeoutMs: 10_000,
  failureThreshold: 2,
  baselineSamples: 3,
  driftEnabled: true,
  tags: '',
  ignorePaths: '',
  url: '',
  method: 'GET',
  headers: [],
  body: '',
  expectedStatus: '',
  maxLatencyMs: '',
  followRedirects: false,
  assertions: [],
  jsonSchema: '',
  provider: 'openai',
  baseUrl: '',
  model: '',
  prompt: 'Reply with the single word: pong',
  system: '',
  maxTokens: 16,
  temperature: 0,
  textAssertions: [{ op: 'contains', value: 'pong' }],
  protocol: 'auto',
  expectedTools: '',
  toolCall: false,
  toolName: '',
  toolArgs: '{}',
  expectText: '',
  existingSecretHeaders: [],
  removedSecretHeaders: [],
  newSecretHeaders: [],
  hasApiKey: false,
  apiKey: '',
  clearApiKey: false,
};

const PATH_OPS = ['exists', 'notExists', 'equals', 'notEquals', 'contains', 'matches', 'type', 'lt', 'gt'];
const TEXT_OPS = ['contains', 'notContains', 'equals', 'matches', 'jsonValid', 'jsonSchema'];

/** Shape of `monitor.config` as returned by the API (validated server-side per kind). */
type StoredConfig = Partial<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  expectedStatus: number[];
  maxLatencyMs: number;
  followRedirects: boolean;
  assertions: { path: string; op: string; value?: unknown }[];
  jsonSchema: unknown;
  provider: FormState['provider'];
  baseUrl: string;
  model: string;
  prompt: string;
  system: string;
  maxTokens: number;
  temperature: number;
  textAssertions: { op: string; value?: unknown }[];
  protocol: FormState['protocol'];
  expectedTools: string[];
  toolCall: { name: string; arguments?: unknown; expectText?: string };
}>;

function fromMonitor(m: Monitor): FormState {
  const c = m.config as StoredConfig;
  const kv = (o: Record<string, string> | undefined) => Object.entries(o ?? {}).map(([k, v]) => ({ k, v }));
  return {
    ...blank,
    name: m.name,
    kind: m.kind,
    enabled: m.enabled,
    intervalSeconds: m.intervalSeconds,
    timeoutMs: m.timeoutMs,
    failureThreshold: m.failureThreshold,
    baselineSamples: m.baselineSamples,
    driftEnabled: m.driftEnabled,
    tags: m.tags.join(', '),
    ignorePaths: m.ignorePaths.join('\n'),
    url: c.url ?? '',
    method: c.method ?? 'GET',
    headers: kv(c.headers),
    body: c.body ?? '',
    expectedStatus: (c.expectedStatus ?? []).join(', '),
    maxLatencyMs: c.maxLatencyMs ? String(c.maxLatencyMs) : '',
    followRedirects: !!c.followRedirects,
    assertions: (c.assertions ?? []).map((a) => ({
      path: a.path,
      op: a.op,
      value: a.value === undefined ? '' : typeof a.value === 'string' ? a.value : JSON.stringify(a.value),
    })),
    jsonSchema: c.jsonSchema ? JSON.stringify(c.jsonSchema, null, 2) : '',
    provider: c.provider ?? 'openai',
    baseUrl: c.baseUrl ?? '',
    model: c.model ?? '',
    prompt: c.prompt ?? '',
    system: c.system ?? '',
    maxTokens: c.maxTokens ?? 16,
    temperature: c.temperature ?? 0,
    textAssertions: (c.textAssertions ?? []).map((a) => ({
      op: a.op,
      value: a.value === undefined ? '' : typeof a.value === 'string' ? a.value : JSON.stringify(a.value, null, 2),
    })),
    protocol: c.protocol ?? 'auto',
    expectedTools: (c.expectedTools ?? []).join(', '),
    toolCall: !!c.toolCall,
    toolName: c.toolCall?.name ?? '',
    toolArgs: c.toolCall ? JSON.stringify(c.toolCall.arguments ?? {}, null, 2) : '{}',
    expectText: c.toolCall?.expectText ?? '',
    existingSecretHeaders: m.secretKeys.headers,
    hasApiKey: m.secretKeys.apiKey,
  };
}

class FormError extends Error {}
const parseJson = (label: string, text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new FormError(`${label} is not valid JSON.`);
  }
};
const loose = (v: string) => {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const list = (s: string, sep = /[,\n]/) =>
  s
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean);
const kvObject = (rows: KV[]) => Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v]));

function buildConfig(f: FormState): Record<string, unknown> {
  const latency = f.maxLatencyMs ? { maxLatencyMs: Number(f.maxLatencyMs) } : {};
  if (f.kind === 'http') {
    return {
      url: f.url.trim(),
      method: f.method,
      headers: kvObject(f.headers),
      ...(f.body && f.method !== 'GET' && f.method !== 'HEAD' ? { body: f.body } : {}),
      expectedStatus: list(f.expectedStatus).map(Number),
      followRedirects: f.followRedirects,
      assertions: f.assertions
        .filter((a) => a.path.trim())
        .map((a) => ({
          path: a.path.trim(),
          op: a.op,
          ...(['exists', 'notExists'].includes(a.op) ? {} : { value: ['type', 'matches'].includes(a.op) ? a.value : loose(a.value) }),
        })),
      ...(f.jsonSchema.trim() ? { jsonSchema: parseJson('JSON Schema', f.jsonSchema) } : {}),
      ...latency,
    };
  }
  if (f.kind === 'llm') {
    return {
      provider: f.provider,
      ...(f.baseUrl.trim() ? { baseUrl: f.baseUrl.trim() } : {}),
      model: f.model.trim(),
      prompt: f.prompt,
      ...(f.system ? { system: f.system } : {}),
      maxTokens: Number(f.maxTokens),
      temperature: Number(f.temperature),
      headers: kvObject(f.headers),
      textAssertions: f.textAssertions.map((a) => ({
        op: a.op,
        ...(a.op === 'jsonValid' ? {} : { value: a.op === 'jsonSchema' ? parseJson('Output JSON Schema', a.value) : a.value }),
      })),
      ...latency,
    };
  }
  return {
    url: f.url.trim(),
    protocol: f.protocol,
    headers: kvObject(f.headers),
    expectedTools: list(f.expectedTools),
    ...(f.toolCall && f.toolName.trim()
      ? {
          toolCall: {
            name: f.toolName.trim(),
            arguments: parseJson('Tool arguments', f.toolArgs || '{}'),
            ...(f.expectText ? { expectText: f.expectText } : {}),
          },
        }
      : {}),
    ...latency,
  };
}

function buildSecrets(f: FormState) {
  const headers: Record<string, string | null> = {};
  for (const h of f.removedSecretHeaders) headers[h] = null;
  for (const r of f.newSecretHeaders) if (r.k.trim() && r.v) headers[r.k.trim()] = r.v;
  const out: { headers?: Record<string, string | null>; apiKey?: string | null } = {};
  if (Object.keys(headers).length) out.headers = headers;
  if (f.kind === 'llm') {
    if (f.apiKey) out.apiKey = f.apiKey;
    else if (f.clearApiKey) out.apiKey = null;
  }
  return out;
}

function KVEditor({
  rows,
  onChange,
  keyLabel,
  valueLabel,
  secret,
}: {
  rows: KV[];
  onChange: (r: KV[]) => void;
  keyLabel: string;
  valueLabel: string;
  secret?: boolean;
}) {
  return (
    <div className="row-editor">
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input
            aria-label={keyLabel}
            placeholder={keyLabel}
            value={r.k}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
          />
          <input
            aria-label={valueLabel}
            placeholder={valueLabel}
            type={secret ? 'password' : 'text'}
            autoComplete="off"
            value={r.v}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
          />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label={`Remove ${r.k || 'row'}`}
          >
            Remove
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn small" onClick={() => onChange([...rows, { k: '', v: '' }])}>
          + Add {secret ? 'secret header' : 'header'}
        </button>
      </div>
    </div>
  );
}

function DryRunResult({ result }: { result: DryRun }) {
  return (
    <div className={`note ${result.ok ? 'ok' : 'error'}`} role="status">
      <strong>{result.ok ? 'Test passed' : `Test failed${result.errorCode ? ` (${result.errorCode})` : ''}`}</strong> · {result.durationMs}{' '}
      ms
      {result.statusCode ? ` · HTTP ${result.statusCode}` : ''}
      {result.observedPaths ? ` · ${result.observedPaths} JSON paths observed` : ''}
      <ul className="assertions" style={{ marginTop: 8 }}>
        {result.assertions.map((a, i) => (
          <li key={i} className={a.ok ? 'ok' : 'fail'}>
            <span className="mark">{a.ok ? '✓' : '✗'}</span>
            <span>
              <strong>{a.name}</strong> — {a.message}
            </span>
          </li>
        ))}
      </ul>
      {result.excerpt ? <pre className="excerpt">{result.excerpt}</pre> : null}
    </div>
  );
}

export function MonitorFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const existing = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => api.get<{ monitor: Monitor }>(`/monitors/${id}`),
    enabled: editing,
  });
  const [f, setF] = useState<FormState>(blank);
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState<unknown>(null);
  const [dry, setDry] = useState<DryRun | null>(null);

  useEffect(() => {
    if (existing.data && !loaded) {
      setF(fromMonitor(existing.data.monitor));
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const test = useMutation({
    mutationFn: () => {
      setError(null);
      return api.post<DryRun>('/monitors/test', {
        kind: f.kind,
        config: buildConfig(f),
        secrets: buildSecrets(f),
        timeoutMs: f.timeoutMs,
        ...(id ? { monitorId: id } : {}),
      });
    },
    onSuccess: setDry,
    onError: (err) => {
      setDry(null);
      setError(err);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name.trim(),
        enabled: f.enabled,
        intervalSeconds: Number(f.intervalSeconds),
        timeoutMs: Number(f.timeoutMs),
        failureThreshold: Number(f.failureThreshold),
        baselineSamples: Number(f.baselineSamples),
        driftEnabled: f.driftEnabled,
        tags: list(f.tags, /[,\s]+/),
        ignorePaths: list(f.ignorePaths, /\n/),
        config: buildConfig(f),
        secrets: buildSecrets(f),
      };
      return editing
        ? api.patch<{ monitor: Monitor }>(`/monitors/${id}`, body)
        : api.post<{ monitor: Monitor }>('/monitors', { ...body, kind: f.kind });
    },
    onSuccess: (res) => {
      toast(editing ? 'Monitor saved.' : 'Monitor created. The baseline is learned from its first checks.');
      void qc.invalidateQueries({ queryKey: ['monitors'] });
      void qc.invalidateQueries({ queryKey: ['monitor', res.monitor.id] });
      void qc.invalidateQueries({ queryKey: ['baseline', res.monitor.id] });
      void qc.invalidateQueries({ queryKey: ['summary'] });
      nav(`/monitors/${res.monitor.id}`);
    },
    onError: (err) => setError(err),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    try {
      buildConfig(f);
    } catch (err) {
      setError(err);
      return;
    }
    save.mutate();
  }
  function runTest() {
    try {
      buildConfig(f);
    } catch (err) {
      setError(err);
      return;
    }
    test.mutate();
  }

  if (editing && !loaded) return existing.error ? <ErrorNote error={existing.error} /> : <Loading />;
  const fieldErr = (path: string) =>
    error instanceof ApiError ? error.details?.find((d) => d.path === path || d.path.startsWith(`${path}/`))?.message : undefined;

  return (
    <>
      <PageHead
        eyebrow={editing ? 'Edit monitor' : 'New monitor'}
        title={editing ? f.name || 'Edit monitor' : 'Watch a dependency'}
        sub={
          editing
            ? 'Changing the request configuration or ignored paths resets the learned baseline.'
            : 'Test the configuration before saving — nothing is stored by a test.'
        }
      />
      <form onSubmit={submit} className="stack" noValidate={false}>
        {error ? error instanceof FormError ? <div className="note error">{error.message}</div> : <ErrorNote error={error} /> : null}

        <section className="panel">
          <div className="panel-head">
            <h2>What to watch</h2>
          </div>
          <div className="panel-body form-grid">
            <Field label="Name" className="span-2">
              <input
                required
                maxLength={120}
                value={f.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Stripe — list customers"
              />
            </Field>
            {!editing ? (
              <div className="field span-2">
                <span className="label-text">Kind</span>
                <div className="segmented" role="group" aria-label="Monitor kind">
                  {(
                    [
                      ['http', 'HTTP JSON API'],
                      ['llm', 'LLM API'],
                      ['mcp', 'MCP server'],
                    ] as [Kind, string][]
                  ).map(([k, l]) => (
                    <button type="button" key={k} aria-pressed={f.kind === k} onClick={() => set('kind', k)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {f.kind === 'http' ? (
              <>
                <Field label="URL" className="span-2" error={fieldErr('config/url')}>
                  <input
                    required
                    type="url"
                    value={f.url}
                    onChange={(e) => set('url', e.target.value)}
                    placeholder="https://api.example.com/v1/items?limit=1"
                  />
                </Field>
                <Field label="Method">
                  <select value={f.method} onChange={(e) => set('method', e.target.value)}>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Expected status codes" help="Comma-separated. Empty = any 2xx.">
                  <input value={f.expectedStatus} onChange={(e) => set('expectedStatus', e.target.value)} placeholder="200" />
                </Field>
                {f.method !== 'GET' && f.method !== 'HEAD' ? (
                  <Field label="Request body" className="span-2">
                    <textarea value={f.body} onChange={(e) => set('body', e.target.value)} placeholder='{"query": "…"}' />
                  </Field>
                ) : null}
                <label className="check span-2">
                  <input type="checkbox" checked={f.followRedirects} onChange={(e) => set('followRedirects', e.target.checked)} /> Follow
                  redirects (credentials are stripped on cross-origin hops)
                </label>
              </>
            ) : null}

            {f.kind === 'llm' ? (
              <>
                <Field label="API format">
                  <select value={f.provider} onChange={(e) => set('provider', e.target.value as FormState['provider'])}>
                    <option value="openai">OpenAI-compatible (Chat Completions)</option>
                    <option value="anthropic">Anthropic (Messages)</option>
                  </select>
                </Field>
                <Field label="Model" error={fieldErr('config/model')}>
                  <input
                    required
                    value={f.model}
                    onChange={(e) => set('model', e.target.value)}
                    placeholder={f.provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5'}
                  />
                </Field>
                <Field
                  label="Base URL"
                  className="span-2"
                  help={`Leave empty for ${f.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'}. Any compatible gateway works.`}
                >
                  <input type="url" value={f.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
                </Field>
                <Field label="Prompt" className="span-2" help="Keep it short and deterministic; each check costs tokens.">
                  <textarea required value={f.prompt} onChange={(e) => set('prompt', e.target.value)} style={{ minHeight: 64 }} />
                </Field>
                <Field label="System prompt (optional)" className="span-2">
                  <input value={f.system} onChange={(e) => set('system', e.target.value)} />
                </Field>
                <Field label="Max output tokens">
                  <input type="number" min={1} max={4096} value={f.maxTokens} onChange={(e) => set('maxTokens', Number(e.target.value))} />
                </Field>
                <Field label="Temperature">
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={f.temperature}
                    onChange={(e) => set('temperature', Number(e.target.value))}
                  />
                </Field>
              </>
            ) : null}

            {f.kind === 'mcp' ? (
              <>
                <Field
                  label="MCP endpoint URL"
                  className="span-2"
                  help="Streamable HTTP endpoint, e.g. https://tools.example.com/mcp"
                  error={fieldErr('config/url')}
                >
                  <input required type="url" value={f.url} onChange={(e) => set('url', e.target.value)} />
                </Field>
                <Field label="Protocol generation" help="Auto tries 2026-07-28 (stateless) first, then the initialize handshake.">
                  <select value={f.protocol} onChange={(e) => set('protocol', e.target.value as FormState['protocol'])}>
                    <option value="auto">Auto-detect</option>
                    <option value="modern">2026-07-28 (stateless)</option>
                    <option value="legacy">Initialize-based (≤ 2025-11-25)</option>
                  </select>
                </Field>
                <Field label="Tools that must exist" help="Comma-separated tool names.">
                  <input
                    value={f.expectedTools}
                    onChange={(e) => set('expectedTools', e.target.value)}
                    placeholder="search, get_document"
                  />
                </Field>
                <label className="check span-2">
                  <input type="checkbox" checked={f.toolCall} onChange={(e) => set('toolCall', e.target.checked)} /> Also call one tool on
                  every check
                </label>
                {f.toolCall ? (
                  <>
                    <Field label="Tool name">
                      <input value={f.toolName} onChange={(e) => set('toolName', e.target.value)} />
                    </Field>
                    <Field label="Output must contain (optional)">
                      <input value={f.expectText} onChange={(e) => set('expectText', e.target.value)} />
                    </Field>
                    <Field label="Arguments (JSON)" className="span-2" help="Use a harmless, read-only call.">
                      <textarea value={f.toolArgs} onChange={(e) => set('toolArgs', e.target.value)} />
                    </Field>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Headers & secrets</h2>
              <div className="cell-sub">Secret values are encrypted at rest and never shown again. Use them for API keys and tokens.</div>
            </div>
          </div>
          <div className="panel-body stack">
            {f.kind === 'llm' ? (
              <Field
                label="API key"
                help={
                  f.hasApiKey
                    ? 'A key is stored. Type a new one to replace it.'
                    : 'Sent as Authorization: Bearer (OpenAI) or x-api-key (Anthropic).'
                }
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={f.apiKey}
                  onChange={(e) => set('apiKey', e.target.value)}
                  placeholder={f.hasApiKey && !f.clearApiKey ? '•••••••• (stored)' : ''}
                />
              </Field>
            ) : null}
            {f.kind === 'llm' && f.hasApiKey ? (
              <label className="check">
                <input type="checkbox" checked={f.clearApiKey} onChange={(e) => set('clearApiKey', e.target.checked)} /> Remove the stored
                API key
              </label>
            ) : null}
            {f.existingSecretHeaders.length ? (
              <div>
                <div className="label-text">Stored secret headers</div>
                {f.existingSecretHeaders.map((h) => {
                  const removed = f.removedSecretHeaders.includes(h);
                  return (
                    <div key={h} className="check" style={{ marginTop: 6 }}>
                      <code style={{ textDecoration: removed ? 'line-through' : undefined }}>{h}: ••••••••</code>
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          set(
                            'removedSecretHeaders',
                            removed ? f.removedSecretHeaders.filter((x) => x !== h) : [...f.removedSecretHeaders, h],
                          )
                        }
                      >
                        {removed ? 'Keep' : 'Remove'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div>
              <div className="label-text" style={{ marginBottom: 6 }}>
                New secret headers
              </div>
              <KVEditor
                rows={f.newSecretHeaders}
                onChange={(r) => set('newSecretHeaders', r)}
                keyLabel="Header name"
                valueLabel="Secret value"
                secret
              />
            </div>
            <div>
              <div className="label-text" style={{ marginBottom: 6 }}>
                Plain headers
              </div>
              <KVEditor rows={f.headers} onChange={(r) => set('headers', r)} keyLabel="Header name" valueLabel="Value" />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Assertions</h2>
              <div className="cell-sub">Optional. Structural drift is detected automatically; add assertions for values you rely on.</div>
            </div>
          </div>
          <div className="panel-body stack">
            {f.kind === 'http' ? (
              <>
                <div className="row-editor">
                  {f.assertions.map((a, i) => (
                    <div className="row three" key={i}>
                      <input
                        aria-label="JSONPath"
                        placeholder="$.data[0].id"
                        value={a.path}
                        onChange={(e) =>
                          set(
                            'assertions',
                            f.assertions.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)),
                          )
                        }
                      />
                      <select
                        aria-label="Operator"
                        value={a.op}
                        onChange={(e) =>
                          set(
                            'assertions',
                            f.assertions.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)),
                          )
                        }
                      >
                        {PATH_OPS.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                      <input
                        aria-label="Expected value"
                        placeholder={['exists', 'notExists'].includes(a.op) ? '—' : 'value (JSON or text)'}
                        disabled={['exists', 'notExists'].includes(a.op)}
                        value={a.value}
                        onChange={(e) =>
                          set(
                            'assertions',
                            f.assertions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn small ghost"
                        onClick={() =>
                          set(
                            'assertions',
                            f.assertions.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <div>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => set('assertions', [...f.assertions, { path: '$.', op: 'exists', value: '' }])}
                    >
                      + Add JSONPath assertion
                    </button>
                  </div>
                </div>
                <Field label="JSON Schema for the response body (optional)" error={fieldErr('config/jsonSchema')}>
                  <textarea
                    value={f.jsonSchema}
                    onChange={(e) => set('jsonSchema', e.target.value)}
                    placeholder='{"type": "object", "required": ["id"]}'
                  />
                </Field>
              </>
            ) : null}
            {f.kind === 'llm' ? (
              <div className="row-editor">
                {f.textAssertions.map((a, i) => (
                  <div className="row" key={i} style={{ gridTemplateColumns: '180px 1fr auto' }}>
                    <select
                      aria-label="Output check"
                      value={a.op}
                      onChange={(e) =>
                        set(
                          'textAssertions',
                          f.textAssertions.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)),
                        )
                      }
                    >
                      {TEXT_OPS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                    {a.op === 'jsonSchema' ? (
                      <textarea
                        aria-label="JSON Schema"
                        value={a.value}
                        onChange={(e) =>
                          set(
                            'textAssertions',
                            f.textAssertions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                      />
                    ) : (
                      <input
                        aria-label="Value"
                        disabled={a.op === 'jsonValid'}
                        value={a.value}
                        onChange={(e) =>
                          set(
                            'textAssertions',
                            f.textAssertions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                          )
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() =>
                        set(
                          'textAssertions',
                          f.textAssertions.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => set('textAssertions', [...f.textAssertions, { op: 'contains', value: '' }])}
                  >
                    + Add output check
                  </button>
                </div>
              </div>
            ) : null}
            <Field label="Max latency (ms, optional)">
              <input
                type="number"
                min={1}
                max={120000}
                value={f.maxLatencyMs}
                onChange={(e) => set('maxLatencyMs', e.target.value)}
                style={{ maxWidth: 200 }}
              />
            </Field>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Schedule & drift</h2>
          </div>
          <div className="panel-body form-grid">
            <Field label="Check every">
              <select value={f.intervalSeconds} onChange={(e) => set('intervalSeconds', Number(e.target.value))}>
                {[30, 60, 120, 300, 600, 900, 1800, 3600, 21600, 86400].map((s) => (
                  <option key={s} value={s}>
                    {s < 60 ? `${s} seconds` : s < 3600 ? `${s / 60} minutes` : `${s / 3600} hours`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Timeout (ms)" error={fieldErr('timeoutMs')}>
              <input type="number" min={500} max={60000} value={f.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
            </Field>
            <Field label="Open an incident after" help="consecutive failed checks">
              <input
                type="number"
                min={1}
                max={20}
                value={f.failureThreshold}
                onChange={(e) => set('failureThreshold', Number(e.target.value))}
              />
            </Field>
            <Field label="Learn baseline from" help="successful responses">
              <input
                type="number"
                min={1}
                max={20}
                value={f.baselineSamples}
                onChange={(e) => set('baselineSamples', Number(e.target.value))}
              />
            </Field>
            <Field label="Tags" help="Used to filter and to scope the CI gate.">
              <input value={f.tags} onChange={(e) => set('tags', e.target.value)} placeholder="payments, prod" />
            </Field>
            <Field label="Ignored paths" help="One per line. Excluded from drift, e.g. $.data[].metadata" error={fieldErr('ignorePaths')}>
              <textarea value={f.ignorePaths} onChange={(e) => set('ignorePaths', e.target.value)} style={{ minHeight: 60 }} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={f.driftEnabled} onChange={(e) => set('driftEnabled', e.target.checked)} /> Detect structural
              drift
            </label>
            <label className="check">
              <input type="checkbox" checked={f.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled
            </label>
          </div>
        </section>

        {dry ? <DryRunResult result={dry} /> : null}
        <div className="actions">
          <button type="submit" className="btn primary" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : null} {editing ? 'Save changes' : 'Create monitor'}
          </button>
          <button type="button" className="btn" onClick={runTest} disabled={test.isPending}>
            {test.isPending ? <Spinner /> : null} Test configuration
          </button>
          <Link className="btn ghost" to={editing ? `/monitors/${id}` : '/monitors'}>
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
