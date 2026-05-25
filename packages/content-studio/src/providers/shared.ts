/**
 * Provider-internal helpers — kept package-private (not re-exported from
 * `index.ts`). Pure functions + thin network helpers; no global state.
 */

import { createHash } from 'node:crypto';

import { assertUrlSafe } from '@borjie/enterprise-hardening';
import { logger } from '../logger.js';

/**
 * SHA-256 hex (first 16 chars) of an input — used by stub providers to
 * synthesize deterministic placeholder URLs. Real provider implementations
 * may reuse this for the C2PA `instanceId` of inputs.
 */
export function deterministicHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────
// Timeouts
// ─────────────────────────────────────────────────────────────────────

/** Default timeouts per modality (ms). */
export const DEFAULT_TIMEOUTS = {
  image: 30_000,
  video: 5 * 60_000,
  voice: 60_000,
} as const;

/**
 * Wraps `fetch` with an `AbortController` so callers can enforce a
 * deterministic upper bound. The returned promise always rejects with a
 * recognisable `ProviderTimeoutError` on expiry so router fallback logic
 * can distinguish timeouts from 5xx.
 */
export class ProviderTimeoutError extends Error {
  readonly providerId: string;
  readonly timeoutMs: number;
  constructor(providerId: string, timeoutMs: number) {
    super(`provider ${providerId} timed out after ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
    this.providerId = providerId;
    this.timeoutMs = timeoutMs;
  }
}

export class ProviderHttpError extends Error {
  readonly providerId: string;
  readonly status: number;
  readonly bodySnippet: string;
  constructor(providerId: string, status: number, bodySnippet: string) {
    super(`provider ${providerId} returned HTTP ${status}: ${bodySnippet.slice(0, 200)}`);
    this.name = 'ProviderHttpError';
    this.providerId = providerId;
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

export interface FetchWithTimeoutArgs {
  readonly providerId: string;
  readonly url: string;
  readonly init: RequestInit;
  readonly timeoutMs: number;
}

/**
 * `fetch` with an `AbortController`-based timeout and a uniform error
 * shape. NEVER logs the request body or headers — those may carry secrets.
 */
export async function fetchWithTimeout(args: FetchWithTimeoutArgs): Promise<Response> {
  // SSRF guard — every multi-modal provider call (Replicate, RunwayML,
  // Suno, …) is screened by the central assertUrlSafe() policy
  // before we open the socket. Vendor hosts are compile-time today;
  // the assertion still runs as defence-in-depth in case a future
  // change introduces a tenant-supplied URL upstream.
  await assertUrlSafe(args.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const res = await fetch(args.url, { ...args.init, signal: controller.signal });
    return res;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProviderTimeoutError(args.providerId, args.timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Lazy env reader
// ─────────────────────────────────────────────────────────────────────

/**
 * Read an env var lazily (i.e. at call time, not module-load time). This
 * lets test runners install env vars after providers have been imported,
 * and keeps the package importable in environments where the var is
 * legitimately absent (CI without secrets).
 */
export function readEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === null) return undefined;
  const trimmed = String(v).trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * `true` when running under vitest / jest. Used to silence the
 * stub-provider warning during the test suite (tests intentionally
 * exercise stubs).
 */
export function isTestMode(): boolean {
  return (
    process.env['NODE_ENV'] === 'test' ||
    process.env['VITEST'] === 'true' ||
    process.env['VITEST_WORKER_ID'] !== undefined ||
    process.env['JEST_WORKER_ID'] !== undefined
  );
}

/** Warn (once per provider) that a stub is being invoked at runtime. */
const warned = new Set<string>();
export function warnStubInvocation(providerId: string, envVarHint: string): void {
  if (isTestMode()) return;
  if (warned.has(providerId)) return;
  warned.add(providerId);
  logger.warn(`[content-studio] provider "${providerId}" is a STUB and produced ` +
      `a placeholder URL. Set ${envVarHint} to enable the real backend.`);
}
