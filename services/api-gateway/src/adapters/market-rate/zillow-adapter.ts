/**
 * Zillow market-rate adapter — concrete `MarketRatePort` backed by the
 * Zillow Rental API (or a RapidAPI Zillow proxy). The exact base URL is
 * env-driven so deployments can point at whichever Zillow gateway they
 * have a contract with — RapidAPI's `zillow-com1`, ATTOM's Zillow
 * proxy, or a direct partner endpoint.
 *
 * Activated only when `ZILLOW_API_KEY` is present. `createZillowAdapterFromEnv`
 * returns `null` otherwise so the composite adapter can skip it.
 *
 * Authentication header format defaults to the RapidAPI convention
 * (`X-RapidAPI-Key`) — overridable via `ZILLOW_API_HEADER` for partners
 * that use a different name (e.g. `Authorization: Bearer ...`).
 *
 * The API key is NEVER surfaced in error messages.
 */

import type {
  ComparableListing,
  MarketRatePort,
} from '@borjie/ai-copilot/ai-native';

export const ZILLOW_ADAPTER_ID = 'zillow' as const;

const DEFAULT_BASE_URL = 'https://zillow-com1.p.rapidapi.com';
const DEFAULT_HEADER = 'X-RapidAPI-Key';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ZillowAdapterDeps {
  readonly apiKey: string;
  readonly apiHeader?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface ZillowEnv {
  readonly ZILLOW_API_KEY?: string;
  readonly ZILLOW_API_HEADER?: string;
  readonly ZILLOW_BASE_URL?: string;
  readonly [key: string]: string | undefined;
}

export function createZillowAdapterFromEnv(
  env: ZillowEnv = process.env as ZillowEnv,
): MarketRatePort | null {
  const apiKey = env.ZILLOW_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return null;
  return createZillowAdapter({
    apiKey,
    ...(env.ZILLOW_API_HEADER !== undefined ? { apiHeader: env.ZILLOW_API_HEADER } : {}),
    ...(env.ZILLOW_BASE_URL !== undefined ? { baseUrl: env.ZILLOW_BASE_URL } : {}),
  });
}

export function createZillowAdapter(
  deps: ZillowAdapterDeps,
): MarketRatePort {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const apiHeader = deps.apiHeader ?? DEFAULT_HEADER;
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    adapterId: ZILLOW_ADAPTER_ID,
    async fetchComparables(params): Promise<readonly ComparableListing[]> {
      // Zillow's rental search needs lat/lon for our use case.
      if (params.latitude === null || params.longitude === null) return [];

      const url = buildZillowUrl(baseUrl, {
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
          `zillow: network error: ${sanitizeMessage(error, deps.apiKey)}`,
        );
      }

      if (!response.ok) {
        throw new Error(`zillow: upstream HTTP ${response.status}`);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new Error(
          `zillow: invalid JSON response: ${sanitizeMessage(error, deps.apiKey)}`,
        );
      }

      return projectZillowProps(body);
    },
  };
}

interface ZillowProperty {
  readonly zpid?: number | string;
  readonly address?: string;
  readonly streetAddress?: string;
  readonly price?: number | string;
  readonly rent?: number | string;
  readonly rentZestimate?: number | string;
  readonly bedrooms?: number;
  readonly bathrooms?: number;
  readonly livingArea?: number;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly detailUrl?: string;
}

interface ZillowSearchResponse {
  readonly props?: readonly ZillowProperty[];
  readonly results?: readonly ZillowProperty[];
}

function projectZillowProps(body: unknown): readonly ComparableListing[] {
  if (!body || typeof body !== 'object') return [];
  const resp = body as ZillowSearchResponse;
  const items = resp.props ?? resp.results ?? [];
  if (!Array.isArray(items)) return [];

  return items
    .map((prop): ComparableListing | null => {
      const rent =
        numericOrNull(prop.rent) ??
        numericOrNull(prop.rentZestimate) ??
        numericOrNull(prop.price);
      if (rent === null) return null;

      const titleSource =
        prop.streetAddress ?? prop.address ?? `Listing ${prop.zpid ?? ''}`;
      const title = String(titleSource).slice(0, 200) || 'Zillow listing';

      const descriptionParts: (string | null)[] = [
        `Monthly rent: ${rent} USD.`,
        prop.bedrooms !== undefined ? `Bedrooms: ${prop.bedrooms}.` : null,
        prop.bathrooms !== undefined ? `Bathrooms: ${prop.bathrooms}.` : null,
        prop.livingArea !== undefined
          ? `Living area: ${prop.livingArea} sqft.`
          : null,
        prop.streetAddress ? `Address: ${prop.streetAddress}.` : null,
      ];
      const description = descriptionParts
        .filter((p): p is string => p !== null)
        .join(' ');

      return {
        adapterId: ZILLOW_ADAPTER_ID,
        url: typeof prop.detailUrl === 'string' ? prop.detailUrl : null,
        title,
        rawDescription: description,
        latitude:
          typeof prop.latitude === 'number' && Number.isFinite(prop.latitude)
            ? prop.latitude
            : null,
        longitude:
          typeof prop.longitude === 'number' && Number.isFinite(prop.longitude)
            ? prop.longitude
            : null,
      };
    })
    .filter((c): c is ComparableListing => c !== null);
}

function buildZillowUrl(
  baseUrl: string,
  query: {
    readonly latitude: number;
    readonly longitude: number;
    readonly radiusKm: number;
    readonly bedrooms: number | null;
  },
): string {
  const u = new URL(`${stripTrailingSlash(baseUrl)}/propertyExtendedSearch`);
  // Build a coarse bounding box from the radius — Zillow's proxy
  // accepts a lat/lon centre with a radius parameter as well, but the
  // bbox form is the most-common variant supported by RapidAPI proxies.
  const degLat = query.radiusKm / 111;
  const degLon =
    query.radiusKm /
    (111 * Math.max(0.01, Math.cos((query.latitude * Math.PI) / 180)));
  u.searchParams.set('south', String(query.latitude - degLat));
  u.searchParams.set('north', String(query.latitude + degLat));
  u.searchParams.set('west', String(query.longitude - degLon));
  u.searchParams.set('east', String(query.longitude + degLon));
  u.searchParams.set('status_type', 'ForRent');
  if (query.bedrooms !== null) {
    u.searchParams.set('bedsMin', String(query.bedrooms));
    u.searchParams.set('bedsMax', String(query.bedrooms));
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

function sanitizeMessage(err: unknown, apiKey: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (apiKey.length === 0) return raw;
  return raw.split(apiKey).join('***');
}
