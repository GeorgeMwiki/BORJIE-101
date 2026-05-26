/**
 * Shared adapter helpers — pulled out so each adapter file stays
 * focused on its API contract.
 *
 * Common concerns: fetch with timeout, env-key resolution, artifact
 * construction (score + bias + audit hash + citation id all in one
 * step), cache wrap, cost-tracker integration, graceful degradation
 * when env keys are absent.
 *
 * @module @borjie/research-tools/adapters/shared
 */

import { hashArtifact } from '../audit/audit-chain-link.js';
import { buildCacheKey } from '../cache/redis-cache.js';
import { deriveCitationId } from '../citations/citation-builder.js';
import { scoreSource } from '../scorer/source-quality.js';
import type {
  Cache,
  CostTracker,
  ResearchArtifact,
  ResearchLogger,
  SourceKind,
  ToolContext,
} from '../types.js';

// ---------------------------------------------------------------------------
// Env-key resolution — never throws; returns undefined when absent
// ===========================================================================

export function readEnvKey(name: string): string | undefined {
  // eslint-disable-next-line no-process-env -- adapter intentionally reads env
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return undefined;
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Fetch with timeout + safe error envelope
// ===========================================================================

export interface SafeFetchOptions {
  readonly url: string;
  readonly init?: RequestInit;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface SafeFetchSuccess {
  readonly ok: true;
  readonly status: number;
  readonly bodyText: string;
  readonly headers: Headers;
}

export interface SafeFetchFailure {
  readonly ok: false;
  readonly status: number;
  readonly reason: 'timeout' | 'network' | 'http_error';
  readonly message: string;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fetch with timeout. Returns a discriminated union; never throws.
 * Adapters call this to keep failure modes uniform.
 */
export async function safeFetch(
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const f = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = {
      ...(options.init ?? {}),
      signal: controller.signal,
    };
    const res = await f(options.url, init);
    const bodyText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: 'http_error',
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    return {
      ok: true,
      status: res.status,
      bodyText,
      headers: res.headers,
    };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
    const message = err instanceof Error ? err.message : 'unknown error';
    return {
      ok: false,
      status: 0,
      reason,
      message,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ---------------------------------------------------------------------------
// Cache wrap — TTL-aware get-or-compute
// ===========================================================================

export interface CacheWrapOptions {
  readonly cache: Cache;
  readonly adapter: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly ttl_seconds: number;
}

/**
 * Try the cache; if hit, return parsed value. Caller writes the cache
 * after a successful compute via `writeCache`.
 */
export async function readCache<T>(
  opts: CacheWrapOptions,
): Promise<T | null> {
  const key = buildCacheKey(opts.adapter, opts.params);
  const raw = await opts.cache.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(
  opts: CacheWrapOptions,
  value: T,
): Promise<void> {
  const key = buildCacheKey(opts.adapter, opts.params);
  try {
    const serialised = JSON.stringify(value);
    await opts.cache.set(key, serialised, opts.ttl_seconds);
  } catch {
    // non-JSON-serialisable value — silently skip the cache write.
  }
}

// ---------------------------------------------------------------------------
// Budget gate — reserve before call, commit / release after
// ===========================================================================

export interface BudgetGateOptions {
  readonly cost_tracker: CostTracker;
  readonly estimated_cost_cents: number;
  readonly logger?: ResearchLogger;
  readonly adapter: string;
  readonly owner_confirm_needed?: () => boolean;
}

export interface BudgetGateResult {
  readonly allowed: boolean;
  readonly reason: 'ok' | 'budget_exceeded' | 'owner_confirm_required';
}

export async function reserveBudget(
  opts: BudgetGateOptions,
): Promise<BudgetGateResult> {
  if (opts.owner_confirm_needed?.()) {
    opts.logger?.warn?.(`${opts.adapter}: owner_confirm required, refusing call`);
    return { allowed: false, reason: 'owner_confirm_required' };
  }
  const ok = await opts.cost_tracker.tryReserve(opts.estimated_cost_cents);
  if (!ok) {
    opts.logger?.warn?.(`${opts.adapter}: budget exceeded, refusing call`);
    return { allowed: false, reason: 'budget_exceeded' };
  }
  return { allowed: true, reason: 'ok' };
}

// ---------------------------------------------------------------------------
// Artifact construction — one helper for every adapter
// ===========================================================================

export interface BuildArtifactInput {
  readonly id: string;
  readonly step_id: string;
  readonly source_uri: string;
  readonly source_kind: SourceKind;
  readonly title: string;
  readonly content: string;
  readonly excerpt: string;
  readonly tool_name: string;
  readonly cost_usd_cents: number;
  readonly retrieved_at?: string;
  readonly published_at?: string;
  readonly is_fast_moving_topic?: boolean;
}

/**
 * Build a ResearchArtifact with score + bias + audit hash + citation
 * id all populated. Adapters call this on every retrieved row.
 */
export function buildArtifact(input: BuildArtifactInput): ResearchArtifact {
  const retrieved_at = input.retrieved_at ?? new Date().toISOString();
  const scoreInput: {
    readonly uri: string;
    readonly content: string;
    readonly retrieved_at: string;
    readonly published_at?: string;
    readonly is_fast_moving_topic?: boolean;
  } = {
    uri: input.source_uri,
    content: input.content,
    retrieved_at,
    ...(input.published_at !== undefined ? { published_at: input.published_at } : {}),
    ...(input.is_fast_moving_topic !== undefined
      ? { is_fast_moving_topic: input.is_fast_moving_topic }
      : {}),
  };
  const score = scoreSource(scoreInput);

  const audit_hash = hashArtifact({
    source_uri: input.source_uri,
    content: input.content,
    retrieved_at,
    tool_name: input.tool_name,
  });
  const citation_id = deriveCitationId(input.source_uri, input.id);

  return {
    id: input.id,
    step_id: input.step_id,
    source_kind: input.source_kind,
    source_uri: input.source_uri,
    source_class: score.class,
    retrieved_at,
    content: input.content,
    excerpt: input.excerpt.slice(0, 2_000),
    title: input.title.slice(0, 500),
    extracted_entities: [],
    quality_score: score.score,
    bias_flags: score.bias_flags,
    citation_id,
    audit_hash,
    tool_name: input.tool_name,
    cost_usd_cents: input.cost_usd_cents,
  };
}

// ---------------------------------------------------------------------------
// Stable artifact id — content-addressable so duplicate calls dedupe
// ===========================================================================

export function deriveArtifactId(
  step_id: string,
  source_uri: string,
  index: number,
): string {
  // Simple deterministic hash over (step_id, source_uri, index).
  const seed = `${step_id}|${source_uri}|${index}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `art_${h.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Logger fallback — never throws, prefers caller-supplied logger
// ===========================================================================

export function pickLogger(ctx: ToolContext): ResearchLogger {
  return (
    ctx.logger ?? {
      warn: () => undefined,
      info: () => undefined,
      error: () => undefined,
    }
  );
}
