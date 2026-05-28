/**
 * Google Air Quality API client — current conditions (UAQI + pollutants).
 *
 * Docs: https://developers.google.com/maps/documentation/air-quality
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §2.2.
 *
 * Endpoint:
 *   POST https://airquality.googleapis.com/v1/currentConditions:lookup?key=...
 */

import type {
  AirQualityIndex,
  AirQualityPollutant,
  AirQualitySnapshot,
  ClientCallOptions,
  GeoResult,
} from '../types.js';
import { asError, fetchJson, missingKeyError, readApiKey, withKey } from './http.js';

const BASE_URL = 'https://airquality.googleapis.com/v1/currentConditions:lookup';

interface UpstreamPollutantConcentration {
  readonly value?: number;
  readonly units?: string;
}
interface UpstreamPollutant {
  readonly code?: string;
  readonly displayName?: string;
  readonly fullName?: string;
  readonly concentration?: UpstreamPollutantConcentration;
}
interface UpstreamIndex {
  readonly code?: string;
  readonly displayName?: string;
  readonly aqi?: number;
  readonly category?: string;
  readonly dominantPollutant?: string;
  readonly color?: { readonly red?: number; readonly green?: number; readonly blue?: number };
}
interface UpstreamCurrentConditions {
  readonly dateTime?: string;
  readonly regionCode?: string;
  readonly indexes?: readonly UpstreamIndex[];
  readonly pollutants?: readonly UpstreamPollutant[];
}

function normalizePollutant(raw: UpstreamPollutant): AirQualityPollutant {
  return {
    code: raw.code ?? 'unknown',
    displayName: raw.displayName ?? '',
    fullName: raw.fullName ?? '',
    concentration: {
      value: raw.concentration?.value ?? 0,
      units: raw.concentration?.units ?? 'µg/m³',
    },
  };
}

function normalizeIndex(raw: UpstreamIndex): AirQualityIndex {
  const out: { -readonly [K in keyof AirQualityIndex]: AirQualityIndex[K] } = {
    code: raw.code ?? 'uaqi',
    displayName: raw.displayName ?? '',
    aqi: raw.aqi ?? 0,
    category: raw.category ?? '',
  };
  if (raw.dominantPollutant !== undefined) {
    out.dominantPollutant = raw.dominantPollutant;
  }
  if (raw.color) {
    out.color = {
      red: raw.color.red ?? 0,
      green: raw.color.green ?? 0,
      blue: raw.color.blue ?? 0,
    };
  }
  return out;
}

function normalize(raw: UpstreamCurrentConditions): AirQualitySnapshot {
  const out: { -readonly [K in keyof AirQualitySnapshot]: AirQualitySnapshot[K] } = {
    dateTime: raw.dateTime ?? new Date().toISOString(),
    indexes: (raw.indexes ?? []).map(normalizeIndex),
    pollutants: (raw.pollutants ?? []).map(normalizePollutant),
  };
  if (raw.regionCode !== undefined) {
    out.regionCode = raw.regionCode;
  }
  return out;
}

export interface CurrentConditionsInput {
  readonly lat: number;
  readonly lng: number;
  /** Default: `["uaqi"]`. Pass `["uaqi", "local_aqi"]` for both. */
  readonly extraComputations?: readonly string[];
}

export async function fetchCurrentConditions(
  input: CurrentConditionsInput,
  options: ClientCallOptions = {},
): Promise<GeoResult<AirQualitySnapshot>> {
  const key = readApiKey(options.apiKey);
  if (!key) return missingKeyError();

  const body = {
    location: { latitude: input.lat, longitude: input.lng },
    extraComputations: input.extraComputations ?? [
      'HEALTH_RECOMMENDATIONS',
      'DOMINANT_POLLUTANT_CONCENTRATION',
      'POLLUTANT_CONCENTRATION',
      'LOCAL_AQI',
      'POLLUTANT_ADDITIONAL_INFO',
    ],
  };

  const result = await fetchJson<UpstreamCurrentConditions>({
    url: withKey(BASE_URL, key),
    method: 'POST',
    body,
    options,
  });
  if (!result.ok) return asError(result);
  return { ok: true, data: normalize(result.data) };
}
