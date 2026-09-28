import type { AssertionResultRow } from '../db/schema.js';
import type { Signature } from '../drift/types.js';
import { sha256 } from '../lib/crypto.js';
import { OutboundError, outboundRequest } from '../lib/http-client.js';
import type { McpConfig, ProbeSecrets } from './config.js';
import { failureFromError, secretValues, withSecretQuery } from './http.js';
import { type ProbeContext, type ProbeOutcome, redactExcerpt, summarize } from './types.js';

/** Stateless protocol generation (no initialize handshake; `server/discover`). */
export const MODERN_VERSION = '2026-07-28';
/** Newest initialize-based protocol version we request; servers may answer with an older one. */
export const LEGACY_VERSION = '2025-11-25';
const CLIENT_INFO = { name: 'tripline', version: '0.2.0' };
const MAX_TOOL_PAGES = 10;

export class McpProtocolError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly body?: string,
  ) {
    super(message);
  }
}

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** Parses a JSON-RPC response from a JSON body or an SSE stream, returning the message for `id`. */
export function parseRpcBody(body: string, contentType: string, id: number): JsonRpcResponse {
  const candidates: unknown[] = [];
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) continue;
      try {
        candidates.push(JSON.parse(data));
      } catch {
        /* ignore non-JSON events */
      }
    }
  } else {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (Array.isArray(parsed)) candidates.push(...parsed);
      else candidates.push(parsed);
    } catch {
      throw new McpProtocolError('Response is not valid JSON.');
    }
  }
  const match = candidates.find((m): m is JsonRpcResponse => !!m && typeof m === 'object' && (m as JsonRpcResponse).id === id);
  if (!match)
    throw new McpProtocolError(
      `No JSON-RPC response with id ${id} in the ${contentType.includes('event-stream') ? 'SSE stream' : 'response'}.`,
    );
  return match;
}

type Session = {
  generation: 'modern' | 'legacy';
  protocolVersion: string;
  sessionId?: string;
  serverName?: string;
  serverVersion?: string;
  nextId: number;
};

class McpClient {
  private durationMs = 0;
  constructor(
    private readonly cfg: McpConfig,
    private readonly secrets: ProbeSecrets,
    private readonly ctx: ProbeContext,
  ) {}

  get elapsed() {
    return this.durationMs;
  }

  private headers(session: Session | null, method: string, name?: string): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.cfg.headers,
      ...this.secrets.headers,
    };
    if (session?.generation === 'modern') {
      h['mcp-protocol-version'] = session.protocolVersion;
      h['mcp-method'] = method;
      if (name) h['mcp-name'] = name;
    } else if (session?.generation === 'legacy') {
      h['mcp-protocol-version'] = session.protocolVersion;
      if (session.sessionId) h['mcp-session-id'] = session.sessionId;
    }
    return h;
  }

  async post(
    session: Session | null,
    method: string,
    params: Record<string, unknown>,
    opts: { notification?: boolean; name?: string; headers?: Record<string, string> } = {},
  ) {
    const id = session ? session.nextId++ : 1;
    const message = opts.notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params };
    const res = await outboundRequest({
      url: withSecretQuery(this.cfg.url, this.secrets),
      method: 'POST',
      headers: { ...this.headers(session, method, opts.name), ...opts.headers },
      body: JSON.stringify(message),
      timeoutMs: this.ctx.timeoutMs,
      allowPrivate: this.ctx.allowPrivateTargets,
    });
    this.durationMs += res.durationMs;
    return { res, id };
  }

  modernMeta(extra: Record<string, unknown> = {}) {
    return {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
        'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
        'io.modelcontextprotocol/clientCapabilities': {},
        ...extra,
      },
    };
  }

  async request(session: Session, method: string, params: Record<string, unknown>, name?: string): Promise<unknown> {
    const fullParams = session.generation === 'modern' ? { ...params, ...this.modernMeta() } : params;
    const { res, id } = await this.post(session, method, fullParams, name ? { name } : {});
    if (res.status === 401 || res.status === 403)
      throw new McpProtocolError(`HTTP ${res.status} (authentication failed).`, res.status, res.body);
    if (res.status === 404 && session.sessionId) throw new McpProtocolError('Session expired (HTTP 404).', res.status, res.body);
    if (res.status < 200 || res.status >= 300) throw new McpProtocolError(`HTTP ${res.status} for ${method}.`, res.status, res.body);
    const rpc = parseRpcBody(res.body, res.headers['content-type'] ?? '', id);
    if (rpc.error)
      throw new McpProtocolError(`${method} failed: JSON-RPC error ${rpc.error.code} ${rpc.error.message}`, res.status, res.body);
    return rpc.result;
  }

  /** Modern (stateless) servers answer `server/discover`. Returns null if the server is not modern. */
  async tryModern(): Promise<Session | null> {
    const session: Session = { generation: 'modern', protocolVersion: MODERN_VERSION, nextId: 1 };
    let result: unknown;
    try {
      result = await this.request(session, 'server/discover', {});
    } catch (err) {
      if (err instanceof OutboundError) throw err; // network problems are not a protocol signal
      if (err instanceof McpProtocolError && (err.httpStatus === 401 || err.httpStatus === 403)) throw err;
      return null;
    }
    const r = result as { supportedVersions?: unknown; _meta?: Record<string, { name?: string; version?: string }> };
    if (!Array.isArray(r?.supportedVersions)) return null;
    if (!r.supportedVersions.includes(MODERN_VERSION)) {
      throw new McpProtocolError(`Server supports ${r.supportedVersions.join(', ')} but not ${MODERN_VERSION}.`);
    }
    const info = r._meta?.['io.modelcontextprotocol/serverInfo'];
    if (info?.name) session.serverName = info.name;
    if (info?.version) session.serverVersion = info.version;
    return session;
  }

  async legacy(): Promise<Session> {
    const { res, id } = await this.post(
      null,
      'initialize',
      { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      { headers: {} },
    );
    if (res.status === 401 || res.status === 403)
      throw new McpProtocolError(`HTTP ${res.status} (authentication failed).`, res.status, res.body);
    if (res.status < 200 || res.status >= 300) throw new McpProtocolError(`HTTP ${res.status} for initialize.`, res.status, res.body);
    const rpc = parseRpcBody(res.body, res.headers['content-type'] ?? '', id);
    if (rpc.error)
      throw new McpProtocolError(`initialize failed: JSON-RPC error ${rpc.error.code} ${rpc.error.message}`, res.status, res.body);
    const r = rpc.result as { protocolVersion?: string; serverInfo?: { name?: string; version?: string } };
    if (typeof r?.protocolVersion !== 'string') throw new McpProtocolError('initialize result has no protocolVersion.');
    const session: Session = { generation: 'legacy', protocolVersion: r.protocolVersion, nextId: 2 };
    const sid = res.headers['mcp-session-id'];
    if (sid) session.sessionId = sid;
    if (r.serverInfo?.name) session.serverName = r.serverInfo.name;
    if (r.serverInfo?.version) session.serverVersion = r.serverInfo.version;
    const note = await this.post(session, 'notifications/initialized', {}, { notification: true });
    if (note.res.status >= 400)
      throw new McpProtocolError(`HTTP ${note.res.status} for notifications/initialized.`, note.res.status, note.res.body);
    return session;
  }

  async close(session: Session) {
    if (session.generation !== 'legacy' || !session.sessionId) return;
    try {
      await outboundRequest({
        url: withSecretQuery(this.cfg.url, this.secrets),
        method: 'DELETE',
        headers: this.headers(session, 'DELETE'),
        timeoutMs: Math.min(this.ctx.timeoutMs, 3000),
        allowPrivate: this.ctx.allowPrivateTargets,
      });
    } catch {
      /* best effort */
    }
  }
}

type Tool = { name: string; description?: string; inputSchema?: Record<string, unknown>; outputSchema?: unknown };

/** Key-order-independent serialization; `required` lists are order-insensitive in JSON Schema. */
function canonical(value: unknown, key?: string): string {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v));
    if (key === 'required') items.sort();
    return `[${items.join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], k)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function toolsSignature(session: { generation: string; protocolVersion: string }, tools: Tool[]): Signature {
  const sig: Signature = {
    'mcp.protocol': {
      value: `${session.generation}:${session.protocolVersion}`,
      severity: 'warning',
      label: 'MCP protocol generation/version',
    },
  };
  for (const t of tools) {
    const required = Array.isArray(t.inputSchema?.required) ? [...(t.inputSchema.required as string[])].sort().join(',') : '';
    sig[`tool:${t.name}:required`] = {
      value: required || '(none)',
      severity: 'breaking',
      label: `Required parameters of tool "${t.name}"`,
    };
    sig[`tool:${t.name}:schema`] = {
      value: sha256(canonical(t.inputSchema ?? {})).slice(0, 16),
      severity: 'info',
      label: `Input schema of tool "${t.name}"`,
    };
  }
  return sig;
}

export async function runMcpProbe(cfg: McpConfig, secrets: ProbeSecrets, ctx: ProbeContext): Promise<ProbeOutcome> {
  const client = new McpClient(cfg, secrets, ctx);
  const secretsList = secretValues(secrets);
  let session: Session | null = null;
  try {
    if (cfg.protocol !== 'legacy') session = await client.tryModern();
    if (!session) {
      if (cfg.protocol === 'modern') throw new McpProtocolError('Server did not answer server/discover (not a 2026-07-28 server).');
      session = await client.legacy();
    }

    const tools: Tool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page++) {
      const result = (await client.request(session, 'tools/list', cursor ? { cursor } : {})) as { tools?: unknown; nextCursor?: unknown };
      if (!Array.isArray(result?.tools)) throw new McpProtocolError('tools/list result has no tools array.');
      for (const t of result.tools) if (t && typeof t === 'object' && typeof (t as Tool).name === 'string') tools.push(t as Tool);
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
      if (!cursor) break;
    }

    const assertions: AssertionResultRow[] = [
      {
        name: 'protocol',
        ok: true,
        message: `${session.generation === 'modern' ? 'Stateless' : 'Initialize-based'} MCP ${session.protocolVersion}.`,
      },
      { name: 'tools/list', ok: true, message: `${tools.length} tools.` },
    ];
    const names = new Set(tools.map((t) => t.name));
    for (const expected of cfg.expectedTools) {
      assertions.push({
        name: `tool "${expected}" present`,
        ok: names.has(expected),
        message: names.has(expected) ? 'Present.' : 'Missing.',
      });
    }

    let toolCallMeta: Record<string, unknown> | undefined;
    if (cfg.toolCall) {
      const name = cfg.toolCall.name;
      try {
        const result = (await client.request(session, 'tools/call', { name, arguments: cfg.toolCall.arguments }, name)) as {
          isError?: boolean;
          content?: { type?: string; text?: string }[];
        };
        const text = (result?.content ?? [])
          .filter((c) => c?.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        toolCallMeta = { isError: !!result?.isError, preview: redactExcerpt(text, secretsList).slice(0, 200) };
        assertions.push({
          name: `tools/call ${name}`,
          ok: !result?.isError,
          message: result?.isError ? `Tool reported an error: ${redactExcerpt(text, secretsList).slice(0, 200)}` : 'Tool call succeeded.',
        });
        if (cfg.toolCall.expectText !== undefined) {
          const ok = text.includes(cfg.toolCall.expectText);
          assertions.push({
            name: `tools/call ${name} output contains ${JSON.stringify(cfg.toolCall.expectText)}`,
            ok,
            message: ok ? 'Contains.' : 'Not found in output.',
          });
        }
      } catch (err) {
        if (!(err instanceof McpProtocolError)) throw err;
        assertions.push({ name: `tools/call ${name}`, ok: false, message: err.message });
      }
    }

    if (cfg.maxLatencyMs !== undefined) {
      assertions.push({
        name: 'latency',
        ok: client.elapsed <= cfg.maxLatencyMs,
        message: `${client.elapsed} ms total (limit ${cfg.maxLatencyMs} ms).`,
      });
    }

    const observed = {
      tools: Object.fromEntries(
        tools.map((t) => [t.name, { inputSchema: t.inputSchema ?? {}, ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}) }]),
      ),
    };
    const { ok, message } = summarize(assertions);
    return {
      ok,
      statusCode: 200,
      durationMs: client.elapsed,
      errorCode: ok ? undefined : 'ASSERTION',
      message,
      assertions,
      observed,
      signature: toolsSignature(session, tools),
      meta: {
        generation: session.generation,
        protocolVersion: session.protocolVersion,
        serverName: session.serverName,
        serverVersion: session.serverVersion,
        toolCount: tools.length,
        ...(toolCallMeta ? { toolCall: toolCallMeta } : {}),
      },
    };
  } catch (err) {
    if (err instanceof McpProtocolError) {
      const auth = err.httpStatus === 401 || err.httpStatus === 403;
      return {
        ok: false,
        statusCode: err.httpStatus,
        durationMs: client.elapsed,
        errorCode: auth ? 'AUTH' : 'PROTOCOL',
        message: err.message,
        assertions: [{ name: 'mcp', ok: false, message: err.message }],
        signature: {},
        meta: {},
        excerpt: err.body ? redactExcerpt(err.body, secretsList) : undefined,
      };
    }
    return failureFromError(err, client.elapsed);
  } finally {
    if (session) await client.close(session);
  }
}
