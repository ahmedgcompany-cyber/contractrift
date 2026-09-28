import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

/**
 * Encrypts a UTF-8 string with AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts).
 * Uses the standard library primitive; no custom cryptography.
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/**
 * Decrypts with the first key that authenticates. Passing several keys (current first, then
 * previous ones) supports key rotation; GCM authentication rejects wrong keys reliably.
 */
export function decrypt(payload: string, keys: Buffer | readonly Buffer[]): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error('Unrecognized encrypted payload format');
  }
  let lastError: unknown;
  for (const key of Buffer.isBuffer(keys) ? [keys] : keys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('No decryption key supplied');
}

export function encryptJson(value: unknown, key: Buffer): string {
  return encrypt(JSON.stringify(value), key);
}

export function decryptJson<T>(payload: string, keys: Buffer | readonly Buffer[]): T {
  return JSON.parse(decrypt(payload, keys)) as T;
}

/** 256-bit random token, base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
