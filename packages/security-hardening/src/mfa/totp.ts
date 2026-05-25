/**
 * RFC 6238 TOTP — HOTP-on-time.
 *
 * Algorithm:
 *   T  = floor((now - T0) / step)
 *   HS = HMAC-SHA1(K, T)              // T as 8-byte big-endian
 *   offset = HS[19] & 0x0F
 *   bin = (HS[offset] & 0x7F) << 24
 *       | (HS[offset+1] & 0xFF) << 16
 *       | (HS[offset+2] & 0xFF) << 8
 *       | (HS[offset+3] & 0xFF)
 *   code = bin mod 10^digits
 *
 * Defaults: 30-second step, 6-digit code, SHA1 (matches every TOTP
 * authenticator on the market — Google Authenticator, Authy, 1Password,
 * Apple Passwords, Microsoft Authenticator). The factory accepts a `now`
 * clock so tests can pin time.
 */

import { createHmac, randomBytes } from 'node:crypto';

/* -------------------------------------------------------------------------- */
/* Base32 (RFC 4648, no padding) — required because TOTP secrets in `otpauth`  */
/* URIs are base32-encoded.                                                   */
/* -------------------------------------------------------------------------- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | (buf[i] ?? 0);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export function fromBase32(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new Error(`invalid base32 character: ${ch}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/* -------------------------------------------------------------------------- */
/* HOTP + TOTP                                                                */
/* -------------------------------------------------------------------------- */

export interface TOTPParams {
  readonly digits: 6 | 7 | 8;
  readonly stepSeconds: number; // typically 30
  readonly algorithm: 'SHA1' | 'SHA256' | 'SHA512';
}

const DEFAULT_PARAMS: TOTPParams = {
  digits: 6,
  stepSeconds: 30,
  algorithm: 'SHA1',
};

function hotp(secret: Uint8Array, counter: number, p: TOTPParams): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian. JS bitwise ops are 32-bit so we split.
  const high = Math.floor(counter / 0x1_0000_0000);
  const low = counter >>> 0;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);

  const hmacAlgo =
    p.algorithm === 'SHA256'
      ? 'sha256'
      : p.algorithm === 'SHA512'
        ? 'sha512'
        : 'sha1';
  const hmac = createHmac(hmacAlgo, Buffer.from(secret));
  hmac.update(buf);
  const hs = hmac.digest();

  const offset = (hs[hs.length - 1] ?? 0) & 0x0f;
  const bin =
    (((hs[offset] ?? 0) & 0x7f) << 24) |
    (((hs[offset + 1] ?? 0) & 0xff) << 16) |
    (((hs[offset + 2] ?? 0) & 0xff) << 8) |
    ((hs[offset + 3] ?? 0) & 0xff);
  const mod = 10 ** p.digits;
  const code = (bin % mod).toString();
  return code.padStart(p.digits, '0');
}

export function totp(
  secret: Uint8Array,
  atMs: number,
  params: Partial<TOTPParams> = {},
): string {
  const p: TOTPParams = { ...DEFAULT_PARAMS, ...params };
  const counter = Math.floor(atMs / 1000 / p.stepSeconds);
  return hotp(secret, counter, p);
}

/* -------------------------------------------------------------------------- */
/* otpauth:// URI — what every authenticator app scans                        */
/* -------------------------------------------------------------------------- */

export interface OtpAuthUriInput {
  readonly issuer: string;
  readonly accountName: string;
  readonly secretBase32: string;
  readonly digits?: 6 | 7 | 8;
  readonly stepSeconds?: number;
  readonly algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
}

export function buildOtpAuthUri(input: OtpAuthUriInput): string {
  const issuer = encodeURIComponent(input.issuer);
  const account = encodeURIComponent(input.accountName);
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: input.algorithm ?? 'SHA1',
    digits: String(input.digits ?? 6),
    period: String(input.stepSeconds ?? 30),
  });
  return `otpauth://totp/${issuer}:${account}?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* TOTP service factory                                                       */
/* -------------------------------------------------------------------------- */

export interface TOTPServiceOptions {
  readonly issuer: string;
  readonly digits?: 6 | 7 | 8;
  readonly stepSeconds?: number;
  readonly algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  /** Clock-skew window in steps each side. Default 1 (±30s with 30s step). */
  readonly windowSteps?: number;
  readonly secretBytes?: number;
  readonly now?: () => number;
  /** Inject a deterministic byte source — defaults to `crypto.randomBytes`. */
  readonly randomBytes?: (n: number) => Uint8Array;
}

export interface TOTPSecret {
  readonly base32: string;
  readonly otpauthUri: string;
}

export interface TOTPVerifyResult {
  readonly ok: boolean;
  /** Which step matched relative to `now` (0, -1, +1, …). */
  readonly delta?: number;
  readonly reason?: string;
}

export interface TOTPService {
  readonly params: TOTPParams;
  generateSecret(input: {
    readonly accountName: string;
  }): TOTPSecret;
  /** Generate the code that should be valid at `at` for the given secret. */
  generate(secretBase32: string, at?: number): string;
  /** Verify a user-supplied code with clock-skew tolerance. */
  verify(secretBase32: string, code: string, at?: number): TOTPVerifyResult;
}

export function createTOTPService(opts: TOTPServiceOptions): TOTPService {
  const params: TOTPParams = {
    digits: opts.digits ?? 6,
    stepSeconds: opts.stepSeconds ?? 30,
    algorithm: opts.algorithm ?? 'SHA1',
  };
  const windowSteps = opts.windowSteps ?? 1;
  const secretBytes = opts.secretBytes ?? 20; // 160-bit, RFC-recommended for SHA1
  const now = opts.now ?? Date.now;
  const rng =
    opts.randomBytes ??
    ((n: number) => new Uint8Array(randomBytes(n)));

  return {
    params,

    generateSecret({ accountName }) {
      const bytes = rng(secretBytes);
      const base32 = toBase32(bytes);
      const otpauthUri = buildOtpAuthUri({
        issuer: opts.issuer,
        accountName,
        secretBase32: base32,
        digits: params.digits,
        stepSeconds: params.stepSeconds,
        algorithm: params.algorithm,
      });
      return { base32, otpauthUri };
    },

    generate(secretBase32, at) {
      const secret = fromBase32(secretBase32);
      return totp(secret, at ?? now(), params);
    },

    verify(secretBase32, code, at) {
      if (typeof code !== 'string') {
        return { ok: false, reason: 'invalid_code_type' };
      }
      const trimmed = code.replace(/\s/g, '');
      if (trimmed.length !== params.digits) {
        return { ok: false, reason: 'invalid_code_length' };
      }
      const t = at ?? now();
      const secret = fromBase32(secretBase32);
      for (let delta = -windowSteps; delta <= windowSteps; delta++) {
        const candidate = totp(
          secret,
          t + delta * params.stepSeconds * 1000,
          params,
        );
        if (constantTimeEqual(candidate, trimmed)) {
          return { ok: true, delta };
        }
      }
      return { ok: false, reason: 'no_match' };
    },
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
