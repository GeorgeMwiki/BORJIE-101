/* eslint-disable no-secrets/no-secrets -- doc-comment example illustrates the env-var syntax; the literal hashes are placeholders, not real keys. */
import { logger } from '../utils/logger.js';
/**
 * API key registry — hashed lookup with per-key tenant/role/scopes binding.
 * Replaces the legacy SUPER_ADMIN-by-any-key pattern from C-1.
 *
 * Key format in env: API_KEY_REGISTRY=keyHash:tenantId:role:scopes,...
 * Example: API_KEY_REGISTRY=abc123hash:demo:ESTATE_MANAGER:read_property read_lease,def456hash:nhc:SUPER_ADMIN:*
 */
/* eslint-enable no-secrets/no-secrets */

import { createHash, timingSafeEqual } from 'node:crypto';
// UserRole alias — avoids circular package import
type UserRole = string;

export interface ApiKeyRecord {
  readonly hash: string;
  readonly tenantId: string;
  readonly role: UserRole;
  readonly scopes: readonly string[];
  readonly serviceName: string;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

let cache: ApiKeyRecord[] | null = null;

function loadRegistry(): ApiKeyRecord[] {
  if (cache) return cache;
  const raw = process.env.API_KEY_REGISTRY ?? '';
  if (!raw) {
    cache = [];
    return cache;
  }
  cache = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(':');
      if (parts.length < 4) return null;
      const [hash, tenantId, role, scopesStr, serviceName] = parts;
      return {
        hash: hash!,
        tenantId: tenantId!,
        role: role as UserRole,
        scopes: (scopesStr ?? '').split(/\s+/).filter(Boolean),
        serviceName: serviceName ?? 'unknown',
      } as ApiKeyRecord;
    })
    .filter((r): r is ApiKeyRecord => r !== null);
  return cache;
}

export function resetApiKeyCache(): void {
  cache = null;
}

/**
 * Resolve an API key to a record. Returns null if key is unknown or registry
 * is empty. Uses timing-safe hash comparison.
 */
export function resolveApiKey(apiKey: string): ApiKeyRecord | null {
  if (!apiKey || apiKey.length < 16) return null;
  const presented = sha256Hex(apiKey);
  const presentedBuf = Buffer.from(presented, 'hex');
  for (const record of loadRegistry()) {
    try {
      const stored = Buffer.from(record.hash, 'hex');
      if (stored.length !== presentedBuf.length) continue;
      if (timingSafeEqual(presentedBuf, stored)) return record;
    } catch {
      // skip malformed hash
    }
  }
  return null;
}

/**
 * Back-compat check — if legacy API_KEYS is set, verify exact match.
 * Emits a deprecation warning at call time. Falls back to registry on miss.
 */
export function resolveApiKeyLegacyOrRegistry(apiKey: string): ApiKeyRecord | null {
  const registryMatch = resolveApiKey(apiKey);
  if (registryMatch) return registryMatch;

  const legacyKeys = (process.env.API_KEYS ?? '').split(',').filter(Boolean);
  if (legacyKeys.length > 0 && legacyKeys.includes(apiKey)) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[auth] CRITICAL: legacy API_KEYS env var is DEPRECATED. Migrate to API_KEY_REGISTRY with per-key tenant/role/scope binding. See Docs/analysis/SECURITY_REVIEW_WAVES_1-3.md#c-1.');
    } else {
      logger.warn('[auth] legacy API_KEYS fallback — migrate to API_KEY_REGISTRY');
    }
    return {
      hash: sha256Hex(apiKey),
      tenantId: 'system',
      role: 'SUPER_ADMIN' as UserRole,
      scopes: ['*'],
      serviceName: 'legacy',
    };
  }

  return null;
}

/**
 * Production startup assertion — refuses to boot if no registry AND no legacy
 * keys are configured, so a misconfigured deploy fails fast instead of
 * silently accepting every request.
 */
export function assertApiKeyConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const hasRegistry = (process.env.API_KEY_REGISTRY ?? '').length > 0;
  const hasLegacy = (process.env.API_KEYS ?? '').length > 0;
  if (!hasRegistry && !hasLegacy) {
    throw new Error(
      'auth: production requires API_KEY_REGISTRY (preferred) or API_KEYS (legacy deprecated) to be set.'
    );
  }
}
