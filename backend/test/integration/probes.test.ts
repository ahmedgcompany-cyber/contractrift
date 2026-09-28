import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeHttpAgents } from '../../src/lib/http-client.js';
import { normalizeConfig, runProbe } from '../../src/probes/index.js';
import { startUpstreams, type Upstreams } from '../support/upstreams.js';

let up: Upstreams;
const ctx = { timeoutMs: 3000, allowPrivateTargets: true };

beforeAll(async () => {
  up = await startUpstreams();
});
afterAll(async () => {
  await up.close();
  await closeHttpAgents();
});
beforeEach(() => up.reset());

describe('http probe', () => {
  it('passes on a healthy JSON endpoint and returns the observed document', async () => {
    const cfg = normalizeConfig('http', {
      url: `${up.url}/json`,
      assertions: [
        { path: '$.name', op: 'equals', value: 'Widget' },
        { path: '$.price', op: 'gt', value: 1 },
        { path: '$.owner.email', op: 'matches', value: '@example\\.com$' },
      ],
      jsonSchema: { type: 'object', required: ['id', 'name'] },
    });
    const out = await runProbe('http', cfg, {}, ctx);
    expect(out.ok).toBe(true);
    expect(out.statusCode).toBe(200);
    expect(out.observed).toMatchObject({ name: 'Widget' });
    expect(out.assertions).toHaveLength(5);
  });

  it('fails with HTTP_STATUS and skips drift on unexpected status', async () => {
    up.state.json.status = 503;
    up.state.json.body = { error: 'down' };
    const out = await runProbe('http', normalizeConfig('http', { url: `${up.url}/json` }), {}, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'HTTP_STATUS', statusCode: 503 });
    expect(out.observed).toBeUndefined();
    expect(out.excerpt).toContain('down');
  });

  it('accepts explicitly expected non-2xx statuses', async () => {
    up.state.json.status = 404;
    const out = await runProbe('http', normalizeConfig('http', { url: `${up.url}/json`, expectedStatus: [404] }), {}, ctx);
    expect(out.ok).toBe(true);
  });

  it('reports assertion failures', async () => {
    const cfg = normalizeConfig('http', { url: `${up.url}/json`, assertions: [{ path: '$.missing', op: 'exists' }] });
    const out = await runProbe('http', cfg, {}, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'ASSERTION' });
    expect(out.message).toContain('$.missing exists');
  });

  it('times out', async () => {
    up.state.json.delayMs = 500;
    const out = await runProbe('http', normalizeConfig('http', { url: `${up.url}/json` }), {}, { ...ctx, timeoutMs: 100 });
    expect(out).toMatchObject({ ok: false, errorCode: 'TIMEOUT' });
  });

  it('flags latency over the limit', async () => {
    up.state.json.delayMs = 120;
    const out = await runProbe('http', normalizeConfig('http', { url: `${up.url}/json`, maxLatencyMs: 50 }), {}, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'LATENCY' });
  });

  it('sends secret headers and redacts them from excerpts', async () => {
    up.state.json.status = 500;
    const cfg = normalizeConfig('http', { url: `${up.url}/echo-headers`, expectedStatus: [201] });
    const out = await runProbe('http', cfg, { headers: { 'x-secret-token': 'supersecretvalue' } }, ctx);
    expect(out.ok).toBe(false);
    expect(out.excerpt).toContain('[REDACTED]');
    expect(out.excerpt).not.toContain('supersecretvalue');
  });

  it('does not follow redirects unless configured', async () => {
    const noFollow = await runProbe('http', normalizeConfig('http', { url: `${up.url}/redirect` }), {}, ctx);
    expect(noFollow).toMatchObject({ ok: false, statusCode: 302 });
    const follow = await runProbe('http', normalizeConfig('http', { url: `${up.url}/redirect`, followRedirects: true }), {}, ctx);
    expect(follow).toMatchObject({ ok: true, statusCode: 200 });
  });

  it('caps response size', async () => {
    const out = await runProbe('http', normalizeConfig('http', { url: `${up.url}/big` }), {}, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'RESPONSE_TOO_LARGE' });
  });

  it('blocks private targets unless allowed', async () => {
    const out = await runProbe('http', normalizeConfig('http', { url: `${up.url}/json` }), {}, { ...ctx, allowPrivateTargets: false });
    expect(out).toMatchObject({ ok: false, errorCode: 'BLOCKED_TARGET' });
    const viaDns = await runProbe(
      'http',
      normalizeConfig('http', { url: up.url.replace('127.0.0.1', 'localhost.') }),
      {},
      { ...ctx, allowPrivateTargets: false },
    );
    expect(viaDns).toMatchObject({ ok: false, errorCode: 'BLOCKED_TARGET' });
  });

  it('reports connection failures', async () => {
    const out = await runProbe('http', normalizeConfig('http', { url: 'http://127.0.0.1:1/x' }), {}, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'CONNECTION' });
  });
});

describe('llm probe', () => {
  it('OpenAI format: extracts text and model, evaluates assertions, tracks model signature', async () => {
    const cfg = normalizeConfig('llm', {
      provider: 'openai',
      baseUrl: `${up.url}/openai/v1`,
      model: 'gpt-test',
      prompt: 'Reply with pong',
      textAssertions: [{ op: 'contains', value: 'PONG' }],
    });
    const out = await runProbe('llm', cfg, { apiKey: 'sk-test-openai-key' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.signature.model?.value).toBe('gpt-test-2026-01-01');
    expect(out.meta).toMatchObject({ requestedModel: 'gpt-test', reportedModel: 'gpt-test-2026-01-01', outputPreview: 'pong' });
  });

  it('OpenAI format: wrong key yields AUTH without leaking the key', async () => {
    const cfg = normalizeConfig('llm', { provider: 'openai', baseUrl: `${up.url}/openai/v1`, model: 'gpt-test', prompt: 'x' });
    const out = await runProbe('llm', cfg, { apiKey: 'sk-wrong-key-123' }, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'AUTH', statusCode: 401 });
    expect(out.message).toContain('Incorrect API key');
    expect(JSON.stringify(out)).not.toContain('sk-wrong-key-123');
  });

  it('Anthropic format with JSON-output schema assertion', async () => {
    up.state.anthropic.text = '```json\n{"answer": 4}\n```';
    const cfg = normalizeConfig('llm', {
      provider: 'anthropic',
      baseUrl: `${up.url}/anthropic`,
      model: 'claude-test',
      prompt: 'What is 2+2? Answer as JSON {"answer": number}',
      textAssertions: [{ op: 'jsonSchema', value: { type: 'object', required: ['answer'], properties: { answer: { const: 4 } } } }],
    });
    const out = await runProbe('llm', cfg, { apiKey: 'sk-ant-test-key' }, ctx);
    expect(out.ok).toBe(true);
    expect(out.signature.model?.value).toBe('claude-test-20260101');
  });

  it('reports failing output assertions', async () => {
    up.state.openai.text = 'I cannot help with that';
    const cfg = normalizeConfig('llm', {
      provider: 'openai',
      baseUrl: `${up.url}/openai/v1`,
      model: 'gpt-test',
      prompt: 'x',
      textAssertions: [{ op: 'notContains', value: 'cannot' }],
    });
    const out = await runProbe('llm', cfg, { apiKey: 'sk-test-openai-key' }, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'ASSERTION' });
  });
});

describe('mcp probe', () => {
  const base = { expectedTools: ['get_weather'], toolCall: { name: 'get_weather', arguments: { city: 'Oslo' }, expectText: 'Oslo' } };

  it('auto-detects a legacy (initialize-based) server, lists tools and calls one', async () => {
    const out = await runProbe('mcp', normalizeConfig('mcp', { url: `${up.url}/mcp-legacy`, ...base }), {}, ctx);
    expect(out.message).toContain('passed');
    expect(out.ok).toBe(true);
    expect(out.meta).toMatchObject({ generation: 'legacy', protocolVersion: '2025-11-25', toolCount: 2, serverName: 'fixture-legacy' });
    expect(out.signature['tool:get_weather:required']?.value).toBe('city');
    // session was closed politely
    expect(up.state.requests.some((r) => r.method === 'DELETE')).toBe(true);
  });

  it('auto-detects a modern (2026-07-28 stateless) server', async () => {
    const out = await runProbe('mcp', normalizeConfig('mcp', { url: `${up.url}/mcp-modern`, ...base }), {}, ctx);
    expect(out.ok).toBe(true);
    expect(out.meta).toMatchObject({ generation: 'modern', protocolVersion: '2026-07-28', serverName: 'fixture-modern' });
    expect(out.signature['mcp.protocol']?.value).toBe('modern:2026-07-28');
  });

  it('parses SSE responses', async () => {
    up.state.mcp.sse = true;
    const out = await runProbe('mcp', normalizeConfig('mcp', { url: `${up.url}/mcp-legacy`, ...base }), {}, ctx);
    expect(out.ok).toBe(true);
  });

  it('fails when the tool reports isError and when expected tools are missing', async () => {
    up.state.mcp.toolError = true;
    up.state.mcp.tools = up.state.mcp.tools.filter((t) => t.name !== 'echo');
    const out = await runProbe(
      'mcp',
      normalizeConfig('mcp', { url: `${up.url}/mcp-modern`, ...base, expectedTools: ['get_weather', 'echo'] }),
      {},
      ctx,
    );
    expect(out.ok).toBe(false);
    const failed = out.assertions.filter((a) => !a.ok).map((a) => a.name);
    expect(failed).toEqual(expect.arrayContaining(['tool "echo" present', 'tools/call get_weather']));
  });

  it('reports AUTH on 401 and sends secret headers', async () => {
    up.state.mcp.token = 'mcp-token-abc';
    const cfg = normalizeConfig('mcp', { url: `${up.url}/mcp-legacy` });
    const bad = await runProbe('mcp', cfg, {}, ctx);
    expect(bad).toMatchObject({ ok: false, errorCode: 'AUTH' });
    const good = await runProbe('mcp', cfg, { headers: { authorization: 'Bearer mcp-token-abc' } }, ctx);
    expect(good.ok).toBe(true);
  });

  it('protocol=modern fails against a legacy server', async () => {
    const out = await runProbe('mcp', normalizeConfig('mcp', { url: `${up.url}/mcp-legacy`, protocol: 'modern' }), {}, ctx);
    expect(out).toMatchObject({ ok: false, errorCode: 'PROTOCOL' });
  });
});

describe('normalizeConfig', () => {
  it('rejects invalid configs with details', () => {
    expect(() => normalizeConfig('http', { url: 'ftp://x' })).toThrow(/Invalid http monitor configuration/);
    expect(() =>
      normalizeConfig('http', { url: 'https://x.test', assertions: [{ path: '$.a', op: 'matches', value: '(a+)+' }] }),
    ).toThrow();
    expect(() =>
      normalizeConfig('llm', {
        provider: 'openai',
        model: 'm',
        prompt: 'p',
        textAssertions: [{ op: 'jsonSchema', value: { type: 'nope' } }],
      }),
    ).toThrow();
    expect(() => normalizeConfig('mcp', { url: 'https://x.test', extra: 1 })).toThrow();
  });
});
