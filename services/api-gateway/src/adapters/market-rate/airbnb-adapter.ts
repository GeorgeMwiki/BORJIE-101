/**
 * Airbnb market-rate adapter — concrete `MarketRatePort` backed by a
 * RapidAPI / partner Airbnb listings proxy. Airbnb publishes no
 * first-party Public API, so any deployment is bringing its own
 * scraper / aggregator behind `AIRBNB_API_KEY`.
 *
 * Activated only when `AIRBNB_API_KEY` is present. The factory returns
 * `null` otherwise so the composite adapter can skip it.
 *
 * Airbnb's nightly rates are not directly comparable to monthly rents,
 * so we annotate the description with a `monthly_estimate ≈ nightly *
 * 30` figure — the downstream extraction LLM (which is provided the
 * `monthlyRentMinor` schema) can pick that up. The annotation is a
 * conservative heuristic; production deployments wanting higher fidelity
 * can post-process via the LLM extraction step.
 *
 * The API key is NEVER surfaced in error messages.
 */

import type {
  ComparableListing,
  MarketRatePort,
} from '@borjie/ai-copilot/ai-native';

export const AIRBNB_ADAPTER_ID = 'airbnb' as const;

const DEFAULT_BASE_URL = 'https://airbnb13.p.rapidapi.com';
const DEFAULT_HEADER = 'X-RapidAPI-Key';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface AirbnbAdapterDeps {
  readonly apiKey: string;
  readonly apiHeader?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface AirbnbEnv {
  readonly AIRBNB_API_KEY?: string;
  readonly AIRBNB_API_HEADER?: string;
  readonly AIRBNB_BASE_URL?: string;
  readonly [key: string]: string | undefined;
}

export function createAirbnbAdapterFromEnv(
  env: AirbnbEnv = process.env as AirbnbEnv,
): MarketRatePort | null {
  const apiKey = env.AIRBNB_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  return createAirbnbAdapter({
    apiKey,
    apiHeader: env.AIRBNB_API_HEADER,
    baseUrl: env.AIRBNB_BASE_URL,
  });
}

export function createAirbnbAdapter(
  deps: AirbnbAdapterDeps,
): MarketRatePort {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiHeader = deps.apiHeader ?? DEFAULT_HEADER;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    adapterId: AIRBNB_ADAPTER_ID,
    async fetchComparables(params): Promise<readonly ComparableListing[]> {
      if (params.latitude === null || params.longitude === null) return [];

      const url = buildAirbnbUrl(baseUrl, {
        latitude: params.latitude,
        longitude: params.longitude,
        radiusKm: params.radiusKm,
        bedrooms: params.bedrooms,
      });

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      headers[apiHeader] = deps.apiKey;

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new Error(
          `airbnb: network error: ${sanitizeMessage(error, deps.apiKey)}`,
        );
      }

      if (!response.ok) {
        throw new Error(`airbnb: upstream HTTP ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new Error(
          `airbnb: invalid JSON response: ${sanitizeMessage(error, deps.apiKey)}`,
        );
      }

      return projectAirbnbResults(body);
    },
  };
}

interface AirbnbListing {
  readonly id?: string | number;
  readonly name?: string;
  readonly title?: string;
  readonly price?: { readonly rate?: number; readonly total?: number };
  readonly rate?: number;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly lat?: number;
  readonly lng?: number;
  readonly url?: string;
}

interface AirbnbResponse {
  readonly results?: readonly AirbnbListing[];
}

function projectAirbnbResults(body: unknown): readonly ComparableListing[] {
  if (!body || typeof body !== 'object') return [];
  const resp = body as AirbnbResponse;
  const items = resp.results;
  if (!Array.isArray(items)) return [];

  return items
    .map((item): ComparableListing | null => {
      const nightly =
        numericOrNull(item.price?.rate) ??
        numericOrNull(item.rate) ??
        numericOrNull(item.price?.total);
      if (nightly === null) return null;

      // Conservative monthly estimate. The extraction LLM may refine
      // this; we surface both figures in the description.
      const monthlyEstimate = Math.round(nightly * 30);
      const titleSource = item.title ?? item.name ?? `Airbnb listing ${item.id ?? ''}`;
      const title = String(titleSource).slice(0, 200) || 'Airbnb listing';

      const descriptionParts: (string | null)[] = [
        `Nightly rate: ${nightly}.`,
        `Monthly estimate (30-night): ${monthlyEstimate}.`,
        `monthlyRentMinor approx ${monthlyEstimate * 100}.`,
        item.bedrooms !== undefined ? `Bedrooms: ${item.bedrooms}.` : null,
        item.bathrooms !== undefined ? `Bathrooms: ${item.bathrooms}.` : null,
      ];
      const description = descriptionParts
        .filter((p): p is string => p !== null)
        .join(' ');

      return {
        adapterId: AIRBNB_ADAPTER_ID,
        url: typeof item.url === 'string' ? item.url : null,
        title,
        rawDescription: description,
        latitude:
          typeof item.lat === 'number' && Number.isFinite(item.lat)
            ? item.lat
            : null,
        longitude:
          typeof item.lng === 'number' && Number.isFinite(item.lng)
            ? item.lng
            : null,
      };
    })
    .filter((c): c is ComparableListing => c !== null);
}

function buildAirbnbUrl(
  baseUrl: string,
  query: {
    readonly latitude: number;
    readonly longitude: number;
    readonly radiusKm: number;
    readonly bedrooms: number | null;
  },
): string {
  const u = new URL(`${stripTrailingSlash(baseUrl)}/search-geo`);
  u.searchParams.set('ne_lat', String(query.latitude + query.radiusKm / 111));
  u.searchParams.set('ne_lng', String(query.longitude + query.radiusKm / 111));
  u.searchParams.set('sw_lat', String(query.latitude - query.radiusKm / 111));
  u.searchParams.set('sw_lng', String(query.longitude - query.radiusKm / 111));
  if (query.bedrooms !== null) {
    u.searchParams.set('minBedrooms', String(query.bedrooms));
  }
  u.searchParams.set('currency', 'USD');
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

function sanitizeMessage(err: unknown, apiKey: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (apiKey.length === 0) return raw;
  return raw.split(apiKey).join('***');
}
