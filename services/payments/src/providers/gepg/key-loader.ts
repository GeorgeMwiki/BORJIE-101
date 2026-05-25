/**
 * Lazy-loads GePG signing keys from file paths or env vars.
 * Caches results in memory after first successful load.
 * Graceful — returns undefined if unset, which routes callers
 * into HMAC/PSP mode with a warning.
 */

import { readFileSync, existsSync } from 'node:fs';

export interface GepgKeys {
  readonly privateKeyPem?: string;
  readonly publicCertPem?: string;
  readonly source: 'env_pem' | 'file_path' | 'missing';
}

let cache: GepgKeys | null = null;

export function loadGepgKeys(): GepgKeys {
  if (cache) return cache;

  const envPrivate = process.env.GEPG_SIGNING_KEY_PEM;
  const envCert = process.env.GEPG_SIGNING_CERT_PEM;
  if (envPrivate || envCert) {
    cache = {
      privateKeyPem: envPrivate,
      publicCertPem: envCert,
      source: 'env_pem',
    };
    return cache;
  }

  const privatePath = process.env.GEPG_SIGNING_KEY_PATH;
  const certPath = process.env.GEPG_SIGNING_CERT_PATH;
  const isSafeAbsolutePath = (p: string): boolean =>
    p.startsWith('/') && !p.includes('\0');
  if (privatePath || certPath) {
    const loaded: { privateKeyPem?: string; publicCertPem?: string } = {};
    if (privatePath && isSafeAbsolutePath(privatePath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied absolute path, validated
      if (existsSync(privatePath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied absolute path, validated
        loaded.privateKeyPem = readFileSync(privatePath, 'utf-8');
      }
    }
    if (certPath && isSafeAbsolutePath(certPath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied absolute path, validated
      if (existsSync(certPath)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied absolute path, validated
        loaded.publicCertPem = readFileSync(certPath, 'utf-8');
      }
    }
    cache = {
      ...loaded,
      source: loaded.privateKeyPem || loaded.publicCertPem ? 'file_path' : 'missing',
    };
    return cache;
  }

  cache = { source: 'missing' };
  return cache;
}

export function resetGepgKeyCache(): void {
  cache = null;
}
