/**
 * Dynamic model registry — smoke-validation probe (the adoption gate).
 *
 * L2 (`fetchLatestForFamily`) discovers the *newest* id a provider
 * advertises on `/v1/models`. Advertised ≠ callable: a freshly-listed
 * id may 404 on retrieval, be region-blocked, or be a preview the
 * account isn't entitled to. Promoting such an id straight into the L1
 * cache would route live traffic at an untested model.
 *
 * This module closes that gap. `validateModel(family, modelId)` runs a
 * **bounded, minimal real call** against the candidate and reports
 * whether it is usable for *this account, right now*:
 *
 *   - providers with a per-model retrieve endpoint (Anthropic / OpenAI /
 *     Google / Cohere) → `GET …/models/{id}`. A reachable, entitled,
 *     un-blocked model answers 2xx; an unknown/withdrawn/region-blocked
 *     id answers 404 (or 400/403). This is the lightweight validate path
 *     the provider already exposes — no generation we'd pay for and
 *     discard, and no request body (so it flows through the canonical
 *     `safeHttpFetch` egress port unchanged).
 *   - providers without a documented per-model retrieve (DeepSeek /
 *     ElevenLabs) → a list re-fetch + membership check. Lighter proof:
 *     it confirms the provider is reachable now and still advertises the
 *     id (catching a transient blip / withdrawn id between the L2 list
 *     read and adoption). Strength is documented per provider below.
 *
 * Contract — mirrors fetchers.ts: **never throws**, fail-soft, 5s cap,
 * uses the same injected fetch port (so the SSRF guard + test mocks flow
 * through identically). Reads provider keys from env at call-time,
 * exactly as `fetchLatestForFamily` does.
 *
 * Outcome is a 3-way discriminated result so the resolver can be exact:
 *
 *   - `pass`    → the candidate is callable. SAFE TO ADOPT.
 *   - `fail`    → the candidate is genuinely unusable for us
 *                 (model-not-found / invalid-model / region-blocked, or
 *                 absent from a reachable list). HOLD BASELINE.
 *   - `skipped` → we could not render a verdict (no API key, auth /
 *                 rate-limit / 5xx / network / timeout). Not the
 *                 candidate's fault, but we still HOLD BASELINE rather
 *                 than adopt an unproven id — the gate fails toward
 *                 safety and retries on the next refresh.
 *
 * IMPORTANT (honest scope): this probe proves a model is *reachable and
 * callable*. It does **not** evaluate answer quality. A model that
 * silently regresses on reasoning/format while still resolving 200 will
 * PASS this gate — guarding prompt-quality regression is the job of the
 * eval-drift logger + the env baseline pin, not the smoke probe.
 */

import type { ModelFamily } from './baselines.js';
import { FAMILY_PATTERNS, extractIds } from './fetchers.js';
import { getFetchPort } from './fetch-port.js';

/** Same bound the L2 list-fetch uses — a probe must never out-wait it. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * HTTP statuses that mean *the candidate model itself* is unusable for
 * this account: bad/unknown model id (400/404) or region/entitlement
 * block (403). Any other non-2xx is treated as inconclusive (`skipped`)
 * so a transient auth/rate/5xx hiccup never gets blamed on the model —
 * and never lets it slip in unproven either.
 */
const MODEL_LEVEL_FAILURE_STATUSES: ReadonlySet<number> = new Set([
  400, 403, 404,
]);

export type ValidateOutcome = 'pass' | 'fail' | 'skipped';

export interface ValidateResult {
  readonly outcome: ValidateOutcome;
  /** Short machine reason for logging; never user-facing. */
  readonly reason: string;
}

/**
 * Providers that expose `GET …/models/{id}`. For these a 404/400/403 is
 * an authoritative "this model is not usable for you" verdict. Providers
 * absent from this set fall back to the list-membership probe.
 */
const RETRIEVE_PROVIDERS: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'google',
  'cohere',
]);

/**
 * True iff every auth header value is non-empty. Mirrors
 * `headersAreComplete` in fetchers.ts — a missing key leaves a `''`
 * value and means there is nothing to probe with.
 */
function authIsPresent(headers: Readonly<Record<string, string>>): boolean {
  const values = Object.values(headers);
  if (values.length === 0) return false;
  return values.every((v) => v.length > 0);
}

/** Drop any `?query` from a URL, leaving the path root. */
function stripQuery(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Build the per-model retrieve URL from a family's list URL. Google
 * carries auth as a `?key=` query param (same as its list call); every
 * other retrieve provider authenticates via the headers we already pass.
 */
function buildRetrieveUrl(
  listUrl: string,
  modelId: string,
  provider: string,
  headers: Readonly<Record<string, string>>,
): string {
  const root = stripQuery(listUrl); // strip e.g. cohere's `?endpoint=embed`
  if (provider === 'google') {
    const key = headers['x-goog-api-key'] ?? '';
    return `${root}/${modelId}?key=${encodeURIComponent(key)}`;
  }
  return `${root}/${encodeURIComponent(modelId)}`;
}

/** Map an HTTP status to a probe outcome for the retrieve path. */
function classifyRetrieveStatus(status: number): ValidateResult {
  if (status >= 200 && status < 300) {
    return { outcome: 'pass', reason: `http-${status}` };
  }
  if (MODEL_LEVEL_FAILURE_STATUSES.has(status)) {
    return { outcome: 'fail', reason: `http-${status}` };
  }
  // 401 / 429 / 5xx / anything else → inconclusive, not the model's
  // fault. Do not adopt; do not blame the candidate.
  return { outcome: 'skipped', reason: `http-${status}` };
}

/** Per-model retrieve probe (Anthropic / OpenAI / Google / Cohere). */
async function retrieveProbe(
  family: ModelFamily,
  modelId: string,
  headers: Readonly<Record<string, string>>,
): Promise<ValidateResult> {
  const pattern = FAMILY_PATTERNS[family];
  const url = buildRetrieveUrl(pattern.url, modelId, pattern.provider, headers);
  // Google reads the key from the query param, so it needs no auth header.
  const probeHeaders = pattern.provider === 'google' ? {} : headers;
  const port = getFetchPort();
  try {
    const result = await port(url, {
      method: 'GET',
      headers: probeHeaders,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    return classifyRetrieveStatus(result.status);
  } catch {
    return { outcome: 'skipped', reason: 'probe-threw' };
  }
}

/**
 * List-membership probe (DeepSeek / ElevenLabs). Re-fetches the
 * provider's model list and confirms the candidate id is still present.
 * Lighter than a retrieve: proves reachability + still-advertised, not
 * end-to-end callability. Absent-from-a-reachable-list ⇒ `fail`;
 * list unreachable / unparseable ⇒ `skipped`.
 */
async function membershipProbe(
  family: ModelFamily,
  modelId: string,
  headers: Readonly<Record<string, string>>,
): Promise<ValidateResult> {
  const pattern = FAMILY_PATTERNS[family];
  const port = getFetchPort();
  let result;
  try {
    result = await port(pattern.url, {
      method: 'GET',
      headers,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch {
    return { outcome: 'skipped', reason: 'probe-threw' };
  }
  if (!result.ok) {
    return classifyRetrieveStatus(result.status);
  }
  let body: unknown;
  try {
    body = await result.json();
  } catch {
    return { outcome: 'skipped', reason: 'probe-parse-failed' };
  }
  const ids = extractIds(body, pattern.provider);
  if (ids.includes(modelId)) {
    return { outcome: 'pass', reason: 'list-membership' };
  }
  return { outcome: 'fail', reason: 'absent-from-list' };
}

/**
 * Smoke-validate a candidate model id. Bounded, fail-soft, never throws.
 *
 * @returns `pass` to adopt, `fail`/`skipped` to hold the baseline.
 */
export async function validateModel(
  family: ModelFamily,
  modelId: string,
): Promise<ValidateResult> {
  const pattern = FAMILY_PATTERNS[family];
  const headers = pattern.authHeader();
  if (!authIsPresent(headers)) {
    return { outcome: 'skipped', reason: 'no-provider-key' };
  }

  if (RETRIEVE_PROVIDERS.has(pattern.provider)) {
    return retrieveProbe(family, modelId, headers);
  }
  return membershipProbe(family, modelId, headers);
}
