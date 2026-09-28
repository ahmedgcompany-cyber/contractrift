/**
 * Local, protocol-faithful stand-ins for the upstreams Tripline monitors. These are real HTTP
 * servers (not mocks of Tripline code); they reproduce the documented request/response formats of:
 *   - a generic JSON API whose response can be changed at runtime (to trigger drift)
 *   - OpenAI Chat Completions (POST /openai/v1/chat/completions)
 *   - Anthropic Messages (POST /anthropic/v1/messages)
 *   - MCP Streamable HTTP, legacy initialize-based (2025-11-25) at /mcp-legacy
 *   - MCP Streamable HTTP, modern stateless (2026-07-28) at /mcp-modern
 *   - a webhook receiver at /hook that records requests
 * They are used by integration tests, E2E tests and `npm run upstreams` for local demos.
 * LIMITATION: they follow the published formats; they cannot prove real provider behaviour.
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Tool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export type UpstreamState = {
  json: { status: number; body: unknown; delayMs: number; contentType: string };
  openai: { apiKey: string; reportedModel: string; text: string; status: number };
  anthropic: { apiKey: string; reportedModel: string; text: string };
  mcp: { token: string | null; tools: Tool[]; sse: boolean; toolError: boolean };
  hooks: { headers: http.IncomingHttpHeaders; body: string; path: string }[];
  hookStatus: number;
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders }[];
};

export function defaultState(): UpstreamState {
  return {
    json: {
      status: 200,
      body: { id: 1, name: 'Widget', price: 9.5, tags: ['a'], owner: { id: 7, email: 'o@example.com' } },
      delayMs: 0,
      contentType: 'application/json',
    },
    openai: { apiKey: 'sk-test-openai-key', reportedModel: 'gpt-test-2026-01-01', text: 'pong', status: 200 },
    anthropic: { apiKey: 'sk-ant-test-key', reportedModel: 'claude-test-20260101', text: 'pong' },
    mcp: {
      token: null,
      sse: false,
      toolError: false,
      tools: [
        {
          name: 'get_weather',
          description: 'Weather for a city',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        },
        { name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      ],
    },
    hooks: [],
    hookStatus: 200,
    requests: [],
  };
}

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function rpc(res: http.ServerResponse, sse: boolean, message: unknown, headers: Record<string, string> = {}) {
  if (sse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', ...headers });
    res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`);
    res.end(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  } else send(res, 200, message, headers);
}

export type Upstreams = { url: string; state: UpstreamState; reset(): void; close(): Promise<void> };

export async function startUpstreams(port = 0): Promise<Upstreams> {
  const state = defaultState();
  const sessions = new Set<string>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    state.requests.push({ method: req.method ?? '', url: url.pathname, headers: req.headers });
    const body = await readBody(req);
    const p = url.pathname;

    if (p === '/json') {
      if (state.json.delayMs) await new Promise((r) => setTimeout(r, state.json.delayMs));
      res.writeHead(state.json.status, { 'content-type': state.json.contentType });
      return res.end(typeof state.json.body === 'string' ? state.json.body : JSON.stringify(state.json.body));
    }
    if (p === '/echo-headers') return send(res, 200, { headers: req.headers });
    if (p === '/redirect') {
      res.writeHead(302, { location: '/json' });
      return res.end();
    }
    if (p === '/big') return send(res, 200, { data: 'x'.repeat(2 * 1024 * 1024) });

    if (p === '/openai/v1/chat/completions' && req.method === 'POST') {
      if (req.headers.authorization !== `Bearer ${state.openai.apiKey}`) {
        return send(res, 401, {
          error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' },
        });
      }
      if (state.openai.status !== 200)
        return send(res, state.openai.status, { error: { message: 'Upstream overloaded', type: 'server_error' } });
      const reqBody = JSON.parse(body) as { model: string; messages: unknown[] };
      return send(res, 200, {
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: state.openai.reportedModel || reqBody.model,
        system_fingerprint: 'fp_test',
        choices: [
          { index: 0, message: { role: 'assistant', content: state.openai.text, refusal: null }, logprobs: null, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
      });
    }

    if (p === '/anthropic/v1/messages' && req.method === 'POST') {
      if (req.headers['x-api-key'] !== state.anthropic.apiKey) {
        return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      }
      if (!req.headers['anthropic-version']) {
        return send(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'anthropic-version header is required' } });
      }
      return send(res, 200, {
        id: `msg_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        model: state.anthropic.reportedModel,
        content: [{ type: 'text', text: state.anthropic.text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      });
    }

    if (p === '/mcp-legacy' || p === '/mcp-modern') {
      if (state.mcp.token && req.headers.authorization !== `Bearer ${state.mcp.token}`) {
        return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
      }
      const modern = p === '/mcp-modern';
      if (req.method === 'DELETE') {
        sessions.delete(String(req.headers['mcp-session-id']));
        res.writeHead(200);
        return res.end();
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        return res.end();
      }
      const msg = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
      const err = (code: number, message: string) => send(res, 200, { jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });

      if (modern) {
        const metaVersion = (msg.params?._meta as Record<string, unknown> | undefined)?.['io.modelcontextprotocol/protocolVersion'];
        if (msg.method === 'initialize') {
          return send(res, 400, {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32602, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'] } },
          });
        }
        if (req.headers['mcp-protocol-version'] !== '2026-07-28' || metaVersion !== '2026-07-28') {
          return send(res, 400, {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32600, message: 'MCP-Protocol-Version header must match _meta' },
          });
        }
        if (req.headers['mcp-method'] !== msg.method)
          return send(res, 400, { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Mcp-Method header mismatch' } });
        if (msg.method === 'server/discover') {
          return rpc(res, false, {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              resultType: 'complete',
              supportedVersions: ['2026-07-28'],
              capabilities: { tools: {} },
              _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'fixture-modern', version: '1.0.0' } },
            },
          });
        }
      } else {
        if (msg.method === 'initialize') {
          const sid = randomUUID();
          sessions.add(sid);
          return rpc(
            res,
            false,
            {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: '2025-11-25',
                capabilities: { tools: {} },
                serverInfo: { name: 'fixture-legacy', version: '1.0.0' },
              },
            },
            { 'mcp-session-id': sid },
          );
        }
        if (msg.method === 'server/discover') return err(-32601, 'Method not found');
        const sid = String(req.headers['mcp-session-id'] ?? '');
        if (!sessions.has(sid))
          return send(res, 404, { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32001, message: 'Session not found' } });
        if (msg.method === 'notifications/initialized') {
          res.writeHead(202);
          return res.end();
        }
      }

      if (msg.method === 'tools/list') return rpc(res, state.mcp.sse, { jsonrpc: '2.0', id: msg.id, result: { tools: state.mcp.tools } });
      if (msg.method === 'tools/call') {
        const name = String(msg.params?.name);
        if (modern && req.headers['mcp-name'] !== name) return err(-32600, 'Mcp-Name header mismatch');
        if (!state.mcp.tools.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`);
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        if (state.mcp.toolError)
          return rpc(res, state.mcp.sse, {
            jsonrpc: '2.0',
            id: msg.id,
            result: { isError: true, content: [{ type: 'text', text: 'backend unavailable' }] },
          });
        const text = name === 'get_weather' ? `Sunny in ${String(args.city)}` : String(args.text ?? '');
        return rpc(res, state.mcp.sse, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
      }
      return err(-32601, 'Method not found');
    }

    if (p.startsWith('/hook')) {
      state.hooks.push({ headers: req.headers, body, path: p });
      return send(res, state.hookStatus, { received: true });
    }

    send(res, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    state,
    reset() {
      Object.assign(state, defaultState());
      sessions.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
