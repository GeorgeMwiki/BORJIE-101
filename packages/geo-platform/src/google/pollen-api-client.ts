/**
 * Google Pollen API client — 5-day daily forecast.
 *
 * Docs: https://developers.google.com/maps/documentation/pollen
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §2.3.
 *
 * Endpoint:
 *   GET https://pollen.googleapis.com/v1/forecast:lookup?location.latitude=..&location.longitude=..&days=5&key=..
 */

import type {
  ClientCallOptions,
  GeoResult,
  PollenDailyForecast,
  PollenForecast,
  PollenType,
  PollenTypeInfo,
} from '../types.js';
import { asError, fetchJson, missingKeyError, readApiKey, withKey } from './http.js';

const BASE_URL = 'https://pollen.googleapis.com/v1/forecast:lookup';

interface UpstreamIndexInfo {
  readonly value?: number;
  readonly category?: string;
}
interface UpstreamPollenTypeInfo {
  readonly code?: string;
  readonly displayName?: string;
  readonly indexInfo?: UpstreamIndexInfo;
  readonly healthRecommendations?: readonly string[];
}
interface UpstreamDailyForecast {
  readonly date?: { readonly year?: number; readonly month?: number; readonly day?: number };
  readonly pollenTypeInfo?: readonly UpstreamPollenTypeInfo[];
}
interface UpstreamForecast {
  readonly regionCode?: string;
  readonly dailyInfo?: readonly UpstreamDailyForecast[];
}

const POLLEN_CODES = new Set<PollenType>(['GRASS', 'TREE', 'WEED']);

function normalizePollenType(raw: UpstreamPollenTypeInfo): PollenTypeInfo {
  const code = POLLEN_CODES.has(raw.code as PollenType) ? (raw.code as PollenType) : 'TREE';
  const out: { -readonly [K in keyof PollenTypeInfo]: PollenTypeInfo[K] } = {
    code,
    displayName: raw.displayName ?? '',
  };
  if (raw.indexInfo) {
    out.indexInfo = {
      value: raw.indexInfo.value ?? 0,
      category: raw.indexInfo.category ?? '',
    };
  }
  if (raw.healthRecommendations !== undefined) {
    out.healthRecommendations = raw.healthRecommendations;
  }
  return out;
}

function normalizeDay(raw: UpstreamDailyForecast): PollenDailyForecast {
  return {
    date: {
      year: raw.date?.year ?? 1970,
      month: raw.date?.month ?? 1,
      day: raw.date?.day ?? 1,
    },
    pollenTypeInfo: (raw.pollenTypeInfo ?? []).map(normalizePollenType),
  };
}

export interface PollenForecastInput {
  readonly lat: number;
  readonly lng: number;
  /** Number of days, 1–5. Default 5. */
  readonly days?: number;
}

export async function fetchPollenForecast(
  input: PollenForecastInput,
  options: ClientCallOptions = {},
): Promise<GeoResult<PollenForecast>> {
  const key = readApiKey(options.apiKey);
  if (!key) return missingKeyError();

  const days = Math.max(1, Math.min(5, input.days ?? 5));
  const query = new URLSearchParams({
    'location.latitude': String(input.lat),
    'location.longitude': String(input.lng),
    days: String(days),
  });
  const result = await fetchJson<UpstreamForecast>({
    url: withKey(`${BASE_URL}?${query.toString()}`, key),
    method: 'GET',
    options,
  });
  if (!result.ok) return asError(result);

  const raw = result.data;
  const data: { -readonly [K in keyof PollenForecast]: PollenForecast[K] } = {
    dailyInfo: (raw.dailyInfo ?? []).map(normalizeDay),
  };
  if (raw.regionCode !== undefined) {
    data.regionCode = raw.regionCode;
  }
  return { ok: true, data };
}
