/**
 * Canonical JSON + sha-256 helpers used by feature fingerprinting
 * and forecast IDs.
 *
 * `canonicalJSON` produces a deterministic UTF-8 string: object keys
 * are sorted, arrays preserve order, numbers use plain toString. This
 * gives stable hashes across Node versions and platforms.
 */

import { createHash } from 'node:crypto';

export function canonicalJSON(value: unknown): string {
  return stringify(value);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function sha256Short(input: string, bytes: number = 12): string {
  if (bytes < 4 || bytes > 32) {
    throw new RangeError('sha256Short: bytes must be in [4, 32]');
  }
  return sha256Hex(input).slice(0, bytes * 2);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new RangeError('canonicalJSON: non-finite number');
      }
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'undefined':
      // Undefined is dropped by JSON.stringify; we match that.
      return 'null';
    case 'object':
      if (Array.isArray(value)) {
        return '[' + value.map((v) => stringify(v)).join(',') + ']';
      }
      return stringifyObject(value as Record<string, unknown>);
    default:
      throw new TypeError('canonicalJSON: unsupported value type ' + typeof value);
  }
}

function stringifyObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + stringify(v));
  }
  return '{' + parts.join(',') + '}';
}
