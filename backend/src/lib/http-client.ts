import dns from 'node:dns';
import net from 'node:net';
import { Agent, type Dispatcher, interceptors } from 'undici';

/** Error raised by the outbound HTTP layer with a stable, user-facing code. */
export class OutboundError extends Error {
  constructor(
    readonly code: 'TIMEOUT' | 'DNS' | 'CONNECTION' | 'TLS' | 'BLOCKED_TARGET' | 'RESPONSE_TOO_LARGE' | 'INVALID_URL' | 'NETWORK',
    message: string,
  ) {
    super(message);
  }
}

// Ranges that must not be reachable unless private targets are explicitly allowed.
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['64:ff9b::', 96],
] as const) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true; // not an IP at all: refuse rather than guess
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/**
 * DNS lookup used for every outbound connection (including redirects). Rejects hostnames that
 * resolve to private/loopback/link-local addresses, which also defeats DNS rebinding because
 * the checked address is the one actually connected to.
 */
function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad) {
      const e = new Error(`Target ${hostname} resolves to a private address (${bad.address})`) as NodeJS.ErrnoException;
      e.code = 'ERR_BLOCKED_TARGET';
      return callback(e, '');
    }
    if (options.all) return callback(null, list);
    const first = list[0];
    if (!first) return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' }), '');
    callback(null, first.address, first.family);
  });
}

const agents = new Map<string, Dispatcher>();

function agentFor(allowPrivate: boolean, followRedirects: boolean): Dispatcher {
  const key = `${allowPrivate}:${followRedirects}`;
  let agent = agents.get(key);
  if (!agent) {
    const base = new Agent({
      connect: allowPrivate ? {} : { lookup: guardedLookup as never },
      keepAliveTimeout: 10_000,
    });
    agent = followRedirects
      ? base.compose(
          interceptors.redirect({
            maxRedirections: 5,
            stripHeadersOnCrossOriginRedirect: ['authorization', 'cookie', 'x-api-key', 'proxy-authorization'],
          }),
        )
      : base;
    agents.set(key, agent);
  }
  return agent;
}

export async function closeHttpAgents(): Promise<void> {
  const all = [...agents.values()];
  agents.clear();
  await Promise.allSettled(all.map((a) => a.close()));
}

export type OutboundRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  allowPrivate: boolean;
  followRedirects?: boolean;
  maxBytes?: number;
};

export type OutboundResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
};

export const DEFAULT_MAX_BYTES = 1024 * 1024;

function classify(err: unknown, timeoutMs: number): OutboundError {
  if (err instanceof OutboundError) return err;
  const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const code = e.code ?? e.cause?.code ?? '';
  const name = e.name ?? '';
  if (code === 'ERR_BLOCKED_TARGET' || e.cause?.code === 'ERR_BLOCKED_TARGET') {
    return new OutboundError('BLOCKED_TARGET', e.cause?.message ?? e.message);
  }
  if (name === 'TimeoutError' || name === 'AbortError' || code.includes('TIMEOUT')) {
    return new OutboundError('TIMEOUT', `No complete response within ${timeoutMs} ms.`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new OutboundError('DNS', `DNS lookup failed (${code}).`);
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) {
    return new OutboundError('CONNECTION', `Connection failed (${code}).`);
  }
  if (code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return new OutboundError('TLS', `TLS error (${code}).`);
  }
  return new OutboundError('NETWORK', e.message || 'Network error.');
}

/** Performs one outbound HTTP request with SSRF protection, a hard timeout and a body size cap. */
export async function outboundRequest(req: OutboundRequest): Promise<OutboundResponse> {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw new OutboundError('INVALID_URL', 'The URL is not valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OutboundError('INVALID_URL', 'Only http and https URLs are supported.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!req.allowPrivate && net.isIP(host) && isBlockedAddress(host)) {
    throw new OutboundError('BLOCKED_TARGET', `Target ${host} is a private address.`);
  }
  if (!req.allowPrivate && (host === 'localhost' || host.endsWith('.localhost'))) {
    throw new OutboundError('BLOCKED_TARGET', `Target ${host} is a private address.`);
  }

  const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;
  const started = performance.now();
  const signal = AbortSignal.timeout(req.timeoutMs);
  try {
    const res = await agentFor(req.allowPrivate, req.followRedirects ?? false).request({
      origin: url.origin,
      path: `${url.pathname}${url.search}`,
      method: (req.method ?? 'GET') as Dispatcher.HttpMethod,
      headers: { 'user-agent': 'Tripline/0.1 (+dependency monitor)', ...req.headers },
      body: req.body,
      signal,
      headersTimeout: req.timeoutMs,
      bodyTimeout: req.timeoutMs,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += (chunk as Buffer).length;
      if (size > maxBytes) {
        res.body.destroy();
        throw new OutboundError('RESPONSE_TOO_LARGE', `Response body exceeded ${maxBytes} bytes.`);
      }
      chunks.push(chunk as Buffer);
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return {
      status: res.statusCode,
      headers,
      body: Buffer.concat(chunks).toString('utf8'),
      durationMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    throw classify(err, req.timeoutMs);
  }
}
