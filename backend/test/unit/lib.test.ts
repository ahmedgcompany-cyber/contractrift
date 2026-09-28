import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseEncryptionKey } from '../../src/config.js';
import { decrypt, decryptJson, encrypt, encryptJson, safeEqual } from '../../src/lib/crypto.js';
import { isBlockedAddress } from '../../src/lib/http-client.js';
import { evaluateJsonPath, parseJsonPath } from '../../src/lib/jsonpath.js';
import { checkRegex, evaluateJsonPathAssertion, evaluateTextAssertion, parseJsonLoose } from '../../src/probes/assertions.js';
import { parseRpcBody, toolsSignature } from '../../src/probes/mcp.js';
import { applySecretsPatch } from '../../src/services/monitors.js';

const KEY = Buffer.alloc(32, 1);

describe('crypto', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const a = encrypt('hello', KEY);
    const b = encrypt('hello', KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe('hello');
    expect(decryptJson(encryptJson({ x: [1] }, KEY), KEY)).toEqual({ x: [1] });
  });

  it('detects tampering and wrong keys', () => {
    const c = encrypt('hello', KEY);
    const parts = c.split('.');
    parts[3] = Buffer.from('HELLO').toString('base64url');
    expect(() => decrypt(parts.join('.'), KEY)).toThrow();
    expect(() => decrypt(c, Buffer.alloc(32, 2))).toThrow();
    expect(() => decrypt('garbage', KEY)).toThrow(/format/);
  });

  it('safeEqual compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('config', () => {
  const key = Buffer.alloc(32).toString('base64');
  it('requires a 32-byte encryption key', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(ConfigError);
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
  it('applies defaults and production-secure cookies', () => {
    const dev = loadConfig({ ENCRYPTION_KEY: key });
    expect(dev).toMatchObject({ port: 3000, cookieSecure: false, allowPrivateTargets: false, schedulerEnabled: true, retentionDays: 30 });
    expect(loadConfig({ ENCRYPTION_KEY: key, NODE_ENV: 'production' }).cookieSecure).toBe(true);
  });
  it('falls back to RENDER_EXTERNAL_URL for APP_URL', () => {
    expect(loadConfig({ ENCRYPTION_KEY: key, RENDER_EXTERNAL_URL: 'https://x.onrender.com/' }).appUrl).toBe('https://x.onrender.com');
    expect(loadConfig({ ENCRYPTION_KEY: key, APP_URL: 'https://a.test', RENDER_EXTERNAL_URL: 'https://x.onrender.com' }).appUrl).toBe(
      'https://a.test',
    );
  });
  it('rejects invalid values', () => {
    expect(() => loadConfig({ ENCRYPTION_KEY: key, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ENCRYPTION_KEY: key, ALLOW_PRIVATE_TARGETS: 'maybe' })).toThrow(/boolean/);
    expect(() => loadConfig({ ENCRYPTION_KEY: key, APP_URL: 'nope' })).toThrow(/APP_URL/);
    expect(() => loadConfig({ ENCRYPTION_KEY: key, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});

describe('SSRF address classification', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.1', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:10.0.0.1', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['2606:4700:4700::1111', false],
    ['not-an-ip', true],
  ])('%s blocked=%s', (addr, blocked) => expect(isBlockedAddress(addr)).toBe(blocked));
});

describe('jsonpath', () => {
  const doc = { a: { b: [{ c: 1 }, { c: 2 }] }, 'x y': true, n: null };
  it('parses and evaluates the supported subset', () => {
    expect(parseJsonPath('$.a.b[1].c')).toEqual(['a', 'b', 1, 'c']);
    expect(evaluateJsonPath(doc, '$.a.b[1].c')).toEqual({ found: true, value: 2 });
    expect(evaluateJsonPath(doc, '$["x y"]')).toEqual({ found: true, value: true });
    expect(evaluateJsonPath(doc, '$.n')).toEqual({ found: true, value: null });
    expect(evaluateJsonPath(doc, '$.a.b[5]').found).toBe(false);
    expect(evaluateJsonPath(doc, '$.a.zz').found).toBe(false);
    expect(evaluateJsonPath(doc, '$.a.b.c').found).toBe(false);
    expect(evaluateJsonPath({}, '$.constructor').found).toBe(false);
  });
  it('rejects unsupported syntax', () => {
    expect(() => parseJsonPath('a.b')).toThrow();
    expect(() => parseJsonPath('$..a')).toThrow();
    expect(() => parseJsonPath('$.a[*]')).toThrow();
  });
});

describe('assertions', () => {
  const doc = { name: 'Widget', n: 5, tags: ['a', 'b'] };
  it.each([
    [{ path: '$.name', op: 'equals', value: 'Widget' }, true],
    [{ path: '$.name', op: 'notEquals', value: 'x' }, true],
    [{ path: '$.tags', op: 'contains', value: 'b' }, true],
    [{ path: '$.name', op: 'contains', value: 'idg' }, true],
    [{ path: '$.n', op: 'lt', value: 10 }, true],
    [{ path: '$.n', op: 'gt', value: 10 }, false],
    [{ path: '$.n', op: 'type', value: 'number' }, true],
    [{ path: '$.name', op: 'matches', value: '^W' }, true],
    [{ path: '$.missing', op: 'notExists' }, true],
    [{ path: '$.missing', op: 'equals', value: 1 }, false],
  ] as const)('%j → %s', (a, ok) => expect(evaluateJsonPathAssertion(doc, a as never).ok).toBe(ok));

  it('text assertions are case-insensitive for contains and tolerate code fences for JSON', () => {
    expect(evaluateTextAssertion('PONG', { op: 'contains', value: 'pong' }).ok).toBe(true);
    expect(evaluateTextAssertion('nope', { op: 'jsonValid' }).ok).toBe(false);
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('rejects dangerous or invalid regexes', () => {
    expect(checkRegex('(a+)+$')).toMatch(/Nested/);
    expect(checkRegex('x'.repeat(201))).toMatch(/200/);
    expect(checkRegex('(')).toBeTruthy();
    expect(checkRegex('^ok$')).toBeNull();
  });
});

describe('mcp helpers', () => {
  it('parses SSE streams and picks the matching id', () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"ok":true}}\n\n';
    expect(parseRpcBody(body, 'text/event-stream', 3).result).toEqual({ ok: true });
    expect(() => parseRpcBody(body, 'text/event-stream', 4)).toThrow(/No JSON-RPC response/);
    expect(() => parseRpcBody('not json', 'application/json', 1)).toThrow(/not valid JSON/);
  });

  it('builds per-tool signatures independent of key order', () => {
    const a = toolsSignature({ generation: 'modern', protocolVersion: 'v' }, [
      { name: 't', inputSchema: { type: 'object', required: ['b', 'a'], properties: { a: {}, b: {} } } },
    ]);
    const b = toolsSignature({ generation: 'modern', protocolVersion: 'v' }, [
      { name: 't', inputSchema: { properties: { b: {}, a: {} }, required: ['a', 'b'], type: 'object' } },
    ]);
    expect(a['tool:t:required']?.value).toBe('a,b');
    expect(a['tool:t:schema']?.value).toBe(b['tool:t:schema']?.value);
  });
});

describe('secrets patching', () => {
  it('merges case-insensitively, deletes with null, keeps omitted', () => {
    const s = applySecretsPatch({ headers: { Authorization: 'x' }, apiKey: 'k' }, { headers: { authorization: 'y', 'x-new': 'z' } });
    expect(s).toEqual({ headers: { authorization: 'y', 'x-new': 'z' }, apiKey: 'k' });
    expect(applySecretsPatch(s, { apiKey: null, headers: { 'X-NEW': null } })).toEqual({ headers: { authorization: 'y' } });
    expect(applySecretsPatch(s, undefined)).toBe(s);
  });
});
