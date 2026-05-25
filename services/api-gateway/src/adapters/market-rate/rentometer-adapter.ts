/**
 * Rentometer market-rate adapter — concrete `MarketRatePort` backed by
 * the Rentometer Public Summary API (`https://www.rentometer.com/api/`).
 *
 * Activated only when `RENTOMETER_API_KEY` is present in the environment.
 * `createRentometerAdapter` returns `null` when the key is missing so the
 * composite adapter can transparently exclude it from the failover list.
 *
 * The API key is NEVER surfaced in error messages. We sanitise upstream
 * errors before re-throwing so a stack trace cannot leak credentials.
 *
 * All network I/O is bounded by a 15s `AbortSignal.timeout` — the
 * surveillance loop is daily/cron-driven and must never hang on a stuck
 * upstream.
 *
 * The Rentometer summary endpoint returns a single neighbourhood-level
 * aggregate (median, mean, percentile breakdown). We project that
 * aggregate into a SINGLE synthetic `ComparableListing` so the
 * extraction LLM downstream can read the embedded median rent figure
 * out of `rawDescription`. This keeps the adapter contract uniform —
 * the agent doesn't need to know which adapter is per-listing vs
 * per-area.
 */

import type {
  ComparableListing,
  MarketRatePort,
} from '@borjie/ai-copilot/ai-native';

export const RENTOMETER_ADAPTER_ID = 'rentometer' as const;

const DEFAULT_BASE_URL = 'https://www.rentometer.com/api/v1';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface RentometerAdapterDeps {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface RentometerEnv {
  readonly RENTOMETER_API_KEY?: string;
  readonly RENTOMETER_BASE_URL?: string;
  readonly [key: string]: string | undefined;
}

/**
 * Factory that returns a configured adapter or `null` when the env var
 * is missing. Use this from the composite adapter / wiring root.
 */
export function createRentometerAdapterFromEnv(
  env: RentometerEnv = process.env as RentometerEnv,
): MarketRatePort | null {
  const apiKey = env.RENTOMETER_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  return createRentometerAdapter({
    apiKey,
    baseUrl: env.RENTOMETER_BASE_URL,
  });
}

export function createRentometerAdapter(
  deps: RentometerAdapterDeps,
): MarketRatePort {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    adapterId: RENTOMETER_ADAPTER_ID,
    async fetchComparables(params): Promise<readonly ComparableListing[]> {
      // Rentometer requires lat/lon; if we don't have them we can't query.
      if (params.latitude === null || params.longitude === null) return [];

      const url = buildRentometerUrl(baseUrl, {
        apiKey: deps.apiKey,
        latitude: params.latitude,
        longitude: params.longitude,
        bedrooms: params.bedrooms,
      });

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(
          `rentometer: network error: ${sanitizeMessage(error, deps.apiKey)}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `rentometer: upstream HTTP ${response.status}`,
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new Error(
          `rentometer: invalid JSON response: ${sanitizeMessage(error, deps.apiKey)}`,
        );
      }

      return projectRentometerSummary(body, params);
    },
  };
}

interface RentometerSummary {
  readonly mean?: number;
  readonly median?: number;
  readonly samples?: number;
  readonly percentile_25?: number;
  readonly percentile_75?: number;
  readonly std_dev?: number;
}

function projectRentometerSummary(
  body: unknown,
  params: {
    readonly unitId: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly bedrooms: number | null;
  },
): readonly ComparableListing[] {
  if (!body || typeof body !== 'object') return [];
  const summary = body as RentometerSummary;
  const median = numericOrNull(summary.median);
  const mean = numericOrNull(summary.mean);
  const samples = numericOrNull(summary.samples);

  // Without a usable rent figure the listing would be useless to the
  // extraction LLM downstream; surface nothing.
  if (median === null && mean === null) return [];

  const headlineRent = median ?? mean ?? 0;
  const description = [
    `Rentometer area summary for unit ${params.unitId}.`,
    `Median monthly rent: ${headlineRent} (currency unknown — see snapshot).`,
    median !== null ? `Median: ${median}.` : null,
    mean !== null ? `Mean: ${mean}.` : null,
    summary.percentile_25 !== undefined
      ? `25th percentile: ${summary.percentile_25}.`
      : null,
    summary.percentile_75 !== undefined
      ? `75th percentile: ${summary.percentile_75}.`
      : null,
    samples !== null ? `Sample size: ${samples}.` : null,
    params.bedrooms !== null ? `Bedrooms: ${params.bedrooms}.` : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ');

  return [
    {
      adapterId: RENTOMETER_ADAPTER_ID,
      url: null,
      title: 'Rentometer area summary',
      rawDescription: description,
      latitude: params.latitude,
      longitude: params.longitude,
    },
  ];
}

function buildRentometerUrl(
  baseUrl: string,
  query: {
    readonly apiKey: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly bedrooms: number | null;
  },
): string {
  const u = new URL(`${stripTrailingSlash(baseUrl)}/summary`);
  u.searchParams.set('api_key', query.apiKey);
  u.searchParams.set('latitude', String(query.latitude));
  u.searchParams.set('longitude', String(query.longitude));
  if (query.bedrooms !== null) {
    u.searchParams.set('bedrooms', String(query.bedrooms));
  }
  return u.toString();
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sanitise an error before re-throwing so the api key never leaks into
 * a stack trace, log line, or telemetry payload.
 */
function sanitizeMessage(err: unknown, apiKey: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (apiKey.length === 0) return raw;
  return raw.split(apiKey).join('***');
}
