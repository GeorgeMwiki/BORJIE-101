/**
 * Dynamic model registry — L2 provider queries.
 *
 * For each known family, `FAMILY_PATTERNS[family]` declares:
 *   - `provider`   — provider short name (used for response-shape extractor)
 *   - `url`        — provider's `/v1/models` endpoint
 *   - `matcher`    — regex selecting the family from the returned list
 *   - `authHeader` — function returning required auth headers (e.g. API key)
 *
 * `fetchLatestForFamily(family)`:
 *   - Builds the auth headers; if any required value is empty (missing
 *     API key), returns `null` immediately — there's no L2 to call.
 *   - Hits the provider with a 5s timeout via the injected fetch port.
 *   - On non-2xx, parse failure, or empty match list → returns `null`.
 *   - On success → picks the newest matching id via `pickNewest`.
 *
 * Returns `null` is the contract for "L2 unavailable / no answer".
 * The resolver translates that to "stick with the L3 baseline (and
 * cache it short)". No errors propagate out — provider downtime must
 * never crash the hot path.
 */

import type { ModelFamily } from './baselines.js';
import { pickNewest } from './version-compare.js';
import {
  getFetchPort,
  type DynamicRegistryFetchResult,
} from './fetch-port.js';

interface FamilyPattern {
  readonly provider:
    | 'anthropic'
    | 'openai'
    | 'google'
    | 'cohere'
    | 'elevenlabs'
    | 'deepseek';
  readonly url: string;
  readonly matcher: RegExp;
  readonly authHeader: () => Record<string, string>;
}

function anthropicAuth(): Record<string, string> {
  return {
    'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
    'anthropic-version': '2023-06-01',
  };
}

function openAiAuth(): Record<string, string> {
  const key = process.env.OPENAI_API_KEY ?? '';
  return key ? { Authorization: `Bearer ${key}` } : { Authorization: '' };
}

function googleAuth(): Record<string, string> {
  // Google AI Studio uses a query-param key, not a header — surface as
  // header here for shape uniformity; the URL is rewritten in
  // `buildUrl` to actually carry the key.
  return { 'x-goog-api-key': process.env.GOOGLE_AI_API_KEY ?? '' };
}

function cohereAuth(): Record<string, string> {
  const key = process.env.COHERE_API_KEY ?? '';
  return key ? { Authorization: `Bearer ${key}` } : { Authorization: '' };
}

function elevenLabsAuth(): Record<string, string> {
  return { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '' };
}

function deepSeekAuth(): Record<string, string> {
  const key = process.env.DEEPSEEK_API_KEY ?? '';
  return key ? { Authorization: `Bearer ${key}` } : { Authorization: '' };
}

export const FAMILY_PATTERNS: Readonly<Record<ModelFamily, FamilyPattern>> =
  Object.freeze({
    opus: {
      provider: 'anthropic',
      url: 'https://api.anthropic.com/v1/models',
      matcher: /^claude-opus-/,
      authHeader: anthropicAuth,
    },
    sonnet: {
      provider: 'anthropic',
      url: 'https://api.anthropic.com/v1/models',
      matcher: /^claude-sonnet-/,
      authHeader: anthropicAuth,
    },
    haiku: {
      provider: 'anthropic',
      url: 'https://api.anthropic.com/v1/models',
      matcher: /^claude-haiku-/,
      authHeader: anthropicAuth,
    },
    'gpt-5': {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      // Match `gpt-5`, `gpt-5.4`, `gpt-5-2025-...` but NOT mini/realtime.
      // The negative lookahead must reject any id whose tail (anywhere
      // after `gpt-5`) contains `mini`, `nano`, or `realtime` — those
      // are sibling families with their own resolver entries.
      matcher: /^gpt-5(?![\d._-]*(?:mini|nano|realtime))(?:[._-]\d.*|$)/,
      authHeader: openAiAuth,
    },
    'gpt-5-mini': {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      matcher: /^gpt-5[._-].*mini/,
      authHeader: openAiAuth,
    },
    'gpt-realtime': {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      matcher: /^gpt-.*realtime/,
      authHeader: openAiAuth,
    },
    whisper: {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      matcher: /^whisper-/,
      authHeader: openAiAuth,
    },
    tts: {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      matcher: /^tts-/,
      authHeader: openAiAuth,
    },
    'dall-e': {
      provider: 'openai',
      url: 'https://api.openai.com/v1/models',
      matcher: /^dall-e-/,
      authHeader: openAiAuth,
    },
    'gemini-pro': {
      provider: 'google',
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      matcher: /gemini-.*-pro(?!.*flash)/,
      authHeader: googleAuth,
    },
    'gemini-flash': {
      provider: 'google',
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      matcher: /gemini-.*-flash/,
      authHeader: googleAuth,
    },
    'cohere-embed': {
      provider: 'cohere',
      url: 'https://api.cohere.com/v1/models?endpoint=embed',
      matcher: /^embed-/,
      authHeader: cohereAuth,
    },
    'cohere-rerank': {
      provider: 'cohere',
      url: 'https://api.cohere.com/v1/models?endpoint=rerank',
      matcher: /^rerank-/,
      authHeader: cohereAuth,
    },
    'eleven-tts': {
      provider: 'elevenlabs',
      url: 'https://api.elevenlabs.io/v1/models',
      matcher: /^eleven_/,
      authHeader: elevenLabsAuth,
    },
    'eleven-stt': {
      provider: 'elevenlabs',
      url: 'https://api.elevenlabs.io/v1/models',
      matcher: /^scribe_/,
      authHeader: elevenLabsAuth,
    },
    'deepseek-chat': {
      provider: 'deepseek',
      url: 'https://api.deepseek.com/v1/models',
      matcher: /^deepseek-chat/,
      authHeader: deepSeekAuth,
    },
    'deepseek-coder': {
      provider: 'deepseek',
      url: 'https://api.deepseek.com/v1/models',
      matcher: /^deepseek-coder/,
      authHeader: deepSeekAuth,
    },
  });

const FETCH_TIMEOUT_MS = 5_000;

/**
 * True iff every value in `headers` is a non-empty string. Missing API
 * keys leave their header value as `''`; we short-circuit in that case
 * because the provider will reject the call anyway.
 */
function headersAreComplete(
  headers: Readonly<Record<string, string>>,
): boolean {
  return Object.values(headers).every((v) => v.length > 0);
}

/**
 * Google's API uses a `?key=` query param instead of header auth. We
 * rewrite the URL here so the fetch port stays provider-agnostic.
 */
function buildUrl(pattern: FamilyPattern, headers: Record<string, string>): string {
  if (pattern.provider !== 'google') return pattern.url;
  const key = headers['x-goog-api-key'];
  if (!key) return pattern.url;
  const sep = pattern.url.includes('?') ? '&' : '?';
  return `${pattern.url}${sep}key=${encodeURIComponent(key)}`;
}

/**
 * Provider-specific id extraction. Each provider's `/v1/models`
 * response has a different envelope; this is the only place that
 * matters about shape.
 */
export function extractIds(data: unknown, provider: FamilyPattern['provider']): string[] {
  if (data === null || data === undefined) return [];
  const ids: string[] = [];

  switch (provider) {
    case 'anthropic':
    case 'openai':
    case 'deepseek': {
      // Shape: { data: [{ id }] }
      const arr = (data as { data?: unknown }).data;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { id?: unknown }).id === 'string'
          ) {
            ids.push((item as { id: string }).id);
          }
        }
      }
      break;
    }
    case 'google': {
      // Shape: { models: [{ name: 'models/gemini-2.5-pro' }] }
      const arr = (data as { models?: unknown }).models;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { name?: unknown }).name === 'string'
          ) {
            const raw = (item as { name: string }).name;
            // Strip the `models/` prefix Google returns.
            ids.push(raw.startsWith('models/') ? raw.slice(7) : raw);
          }
        }
      }
      break;
    }
    case 'cohere': {
      // Shape: { models: [{ name: 'embed-v4.0' }] }
      const arr = (data as { models?: unknown }).models;
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { name?: unknown }).name === 'string'
          ) {
            ids.push((item as { name: string }).name);
          }
        }
      }
      break;
    }
    case 'elevenlabs': {
      // Shape: [{ model_id: 'eleven_v3' }]
      if (Array.isArray(data)) {
        for (const item of data) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { model_id?: unknown }).model_id === 'string'
          ) {
            ids.push((item as { model_id: string }).model_id);
          }
        }
      }
      break;
    }
  }

  return ids;
}

/**
 * L2 query for `family`. Returns the newest matching id, or `null` on
 * any failure (missing key, network error, non-2xx, parse failure,
 * no matching id, timeout). Never throws.
 */
export async function fetchLatestForFamily(
  family: ModelFamily,
): Promise<string | null> {
  const pattern = FAMILY_PATTERNS[family];
  const headers = pattern.authHeader();
  if (!headersAreComplete(headers)) return null;

  const url = buildUrl(pattern, headers);
  const port = getFetchPort();

  let result: DynamicRegistryFetchResult;
  try {
    result = await port(url, {
      method: 'GET',
      headers,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
  } catch {
    return null;
  }

  if (!result.ok) return null;

  let body: unknown;
  try {
    body = await result.json();
  } catch {
    return null;
  }

  const ids = extractIds(body, pattern.provider);
  const matching = ids.filter((id) => pattern.matcher.test(id));
  if (matching.length === 0) return null;
  return pickNewest(matching);
}
