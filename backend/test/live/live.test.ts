/**
 * Opt-in tests against REAL external services. Not part of `npm test`.
 *   npm run test:live                      # public services only (GitHub API, DeepWiki MCP, Hugging Face MCP)
 * Optional, each enables more tests:
 *   LIVE_LLM_BASE_URL=http://localhost:1234/v1 LIVE_LLM_MODEL=<model>   # any OpenAI-compatible server (LM Studio, Ollama, vLLM…)
 *   LIVE_OPENAI_API_KEY=sk-…    [LIVE_OPENAI_MODEL=gpt-4o-mini]
 *   LIVE_ANTHROPIC_API_KEY=sk-ant-…  [LIVE_ANTHROPIC_MODEL=claude-haiku-4-5]
 * These cost a few tokens per run when API keys are set. Results depend on third parties.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { diffShape } from '../../src/drift/diff.js';
import { inferShape, mergeShapes } from '../../src/drift/shape.js';
import { closeHttpAgents } from '../../src/lib/http-client.js';
import { normalizeConfig, runProbe } from '../../src/probes/index.js';

const PUBLIC = { timeoutMs: 30_000, allowPrivateTargets: false };
const env = process.env;
afterAll(() => closeHttpAgents());

describe('public HTTP API (GitHub)', () => {
  it('passes through the SSRF guard, asserts a value, and repeated samples do not drift', async () => {
    const cfg = normalizeConfig('http', {
      url: 'https://api.github.com/repos/nodejs/node',
      headers: { accept: 'application/vnd.github+json' },
      assertions: [{ path: '$.full_name', op: 'equals', value: 'nodejs/node' }],
    });
    const a = await runProbe('http', cfg, {}, PUBLIC);
    expect(a.ok, a.message).toBe(true);
    const b = await runProbe('http', cfg, {}, PUBLIC);
    const baseline = mergeShapes(inferShape(a.observed), inferShape(a.observed));
    expect(diffShape(baseline, inferShape(b.observed)).filter((c) => c.severity !== 'info')).toEqual([]);
  });
});

describe('public MCP servers', () => {
  it('DeepWiki (initialize-based protocol): lists tools and calls one', async () => {
    const out = await runProbe(
      'mcp',
      normalizeConfig('mcp', {
        url: 'https://mcp.deepwiki.com/mcp',
        expectedTools: ['read_wiki_structure'],
        toolCall: { name: 'read_wiki_structure', arguments: { repoName: 'nodejs/node' } },
      }),
      {},
      PUBLIC,
    );
    expect(out.ok, out.message).toBe(true);
    expect(out.meta.generation).toBe('legacy');
  });

  it('Hugging Face (2026-07-28 stateless protocol): discovers, lists tools and calls one', async () => {
    const out = await runProbe(
      'mcp',
      normalizeConfig('mcp', {
        url: 'https://huggingface.co/mcp',
        protocol: 'auto',
        toolCall: { name: 'hub_repo_search', arguments: { query: 'whisper', limit: 1 } },
      }),
      {},
      PUBLIC,
    );
    expect(out.ok, out.message).toBe(true);
    expect(out.meta).toMatchObject({ generation: 'modern', protocolVersion: '2026-07-28' });
  });
});

describe.skipIf(!env.LIVE_LLM_BASE_URL || !env.LIVE_LLM_MODEL)('OpenAI-compatible server (LIVE_LLM_BASE_URL)', () => {
  it('returns output text and a reported model', async () => {
    const out = await runProbe(
      'llm',
      normalizeConfig('llm', {
        provider: 'openai',
        baseUrl: env.LIVE_LLM_BASE_URL,
        model: env.LIVE_LLM_MODEL,
        prompt: 'Reply with one word.',
        maxTokens: 16,
      }),
      env.LIVE_LLM_API_KEY ? { apiKey: env.LIVE_LLM_API_KEY } : {},
      { timeoutMs: 180_000, allowPrivateTargets: true },
    );
    // Protocol-level success; content checks are the user's assertions, not ours.
    expect(out.statusCode).toBe(200);
    expect(out.errorCode, out.message).toBeUndefined();
    expect(out.signature.model?.value).toBeTruthy();
  });
});

describe.skipIf(!env.LIVE_OPENAI_API_KEY)('OpenAI API', () => {
  it('chat completion succeeds and reports a model', async () => {
    const out = await runProbe(
      'llm',
      normalizeConfig('llm', {
        provider: 'openai',
        model: env.LIVE_OPENAI_MODEL ?? 'gpt-4o-mini',
        prompt: 'Reply with the word pong.',
        maxTokens: 8,
      }),
      { apiKey: env.LIVE_OPENAI_API_KEY! },
      PUBLIC,
    );
    expect(out.errorCode, out.message).toBeUndefined();
    expect(out.signature.model?.value).toBeTruthy();
  });
});

describe.skipIf(!env.LIVE_ANTHROPIC_API_KEY)('Anthropic API', () => {
  it('messages call succeeds and reports a model', async () => {
    const out = await runProbe(
      'llm',
      normalizeConfig('llm', {
        provider: 'anthropic',
        model: env.LIVE_ANTHROPIC_MODEL ?? 'claude-haiku-4-5',
        prompt: 'Reply with the word pong.',
        maxTokens: 8,
      }),
      { apiKey: env.LIVE_ANTHROPIC_API_KEY! },
      PUBLIC,
    );
    expect(out.errorCode, out.message).toBeUndefined();
    expect(out.signature.model?.value).toBeTruthy();
  });
});
