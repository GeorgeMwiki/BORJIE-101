/**
 * Google Solar API client — rooftop irradiance + panel recommendations.
 *
 * Docs: https://developers.google.com/maps/documentation/solar
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §2.1.
 *
 * Endpoint:
 *   GET https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=..&location.longitude=..&key=..
 *
 * Coverage drops to zero in East Africa; we return a structured
 * `unsupported_region` error from a 404 so callers can degrade to the
 * drone-DEM fallback.
 */

import type {
  ClientCallOptions,
  GeoResult,
  SolarBuildingInsights,
  SolarRoofSegment,
} from '../types.js';
import { asError, fetchJson, missingKeyError, readApiKey, withKey } from './http.js';

const BASE_URL = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';

interface UpstreamRoofSegment {
  readonly pitchDegrees?: number;
  readonly azimuthDegrees?: number;
  readonly stats?: { readonly areaMeters2?: number; readonly sunshineQuantiles?: readonly number[] };
}

interface UpstreamSolarPotential {
  readonly maxArrayPanelsCount?: number;
  readonly maxArrayAreaMeters2?: number;
  readonly maxSunshineHoursPerYear?: number;
  readonly carbonOffsetFactorKgPerMwh?: number;
  readonly roofSegmentStats?: readonly UpstreamRoofSegment[];
}

interface UpstreamBuildingInsights {
  readonly name?: string;
  readonly center?: { readonly latitude?: number; readonly longitude?: number };
  readonly postalCode?: string;
  readonly regionCode?: string;
  readonly imageryQuality?: string;
  readonly imageryDate?: { readonly year?: number; readonly month?: number; readonly day?: number };
  readonly solarPotential?: UpstreamSolarPotential;
}

function normalizeSegment(raw: UpstreamRoofSegment): SolarRoofSegment {
  const area = raw.stats?.areaMeters2 ?? 0;
  // sunshineQuantiles[len-1] is the annual sun-hours for the segment.
  const quantiles = raw.stats?.sunshineQuantiles ?? [];
  const sun = quantiles.length > 0 ? (quantiles[quantiles.length - 1] ?? 0) : 0;
  return {
    pitchDegrees: raw.pitchDegrees ?? 0,
    azimuthDegrees: raw.azimuthDegrees ?? 0,
    areaSqm: area,
    sunshineHoursPerYear: sun,
  };
}

function normalize(raw: UpstreamBuildingInsights): SolarBuildingInsights {
  const sp = raw.solarPotential ?? {};
  const imageryQuality =
    raw.imageryQuality === 'HIGH' ||
    raw.imageryQuality === 'MEDIUM' ||
    raw.imageryQuality === 'LOW'
      ? raw.imageryQuality
      : 'BASE';
  const out: { -readonly [K in keyof SolarBuildingInsights]: SolarBuildingInsights[K] } = {
    name: raw.name ?? '',
    center: { lat: raw.center?.latitude ?? 0, lng: raw.center?.longitude ?? 0 },
    imageryQuality,
    solarPotential: {
      maxArrayPanelsCount: sp.maxArrayPanelsCount ?? 0,
      maxArrayAreaSqm: sp.maxArrayAreaMeters2 ?? 0,
      maxSunshineHoursPerYear: sp.maxSunshineHoursPerYear ?? 0,
      carbonOffsetFactorKgPerMwh: sp.carbonOffsetFactorKgPerMwh ?? 0,
      roofSegments: (sp.roofSegmentStats ?? []).map(normalizeSegment),
    },
  };
  if (raw.postalCode !== undefined) {
    out.postalCode = raw.postalCode;
  }
  if (raw.regionCode !== undefined) {
    out.regionCode = raw.regionCode;
  }
  if (raw.imageryDate && raw.imageryDate.year && raw.imageryDate.month && raw.imageryDate.day) {
    out.imageryDate = {
      year: raw.imageryDate.year,
      month: raw.imageryDate.month,
      day: raw.imageryDate.day,
    };
  }
  return out;
}

export interface BuildingInsightsInput {
  readonly lat: number;
  readonly lng: number;
  /** "HIGH" | "MEDIUM" | "LOW" — server-side gate on imagery quality. */
  readonly requiredQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
}

export async function fetchBuildingInsights(
  input: BuildingInsightsInput,
  options: ClientCallOptions = {},
): Promise<GeoResult<SolarBuildingInsights>> {
  const key = readApiKey(options.apiKey);
  if (!key) return missingKeyError();

  const query = new URLSearchParams({
    'location.latitude': String(input.lat),
    'location.longitude': String(input.lng),
  });
  if (input.requiredQuality) {
    query.set('requiredQuality', input.requiredQuality);
  }
  const url = `${BASE_URL}?${query.toString()}`;
  const result = await fetchJson<UpstreamBuildingInsights>({
    url: withKey(url, key),
    method: 'GET',
    options,
  });
  if (!result.ok) {
    // Solar 404 = no imagery for this region. Reshape to unsupported_region.
    const err = asError(result).error;
    if (err.status === 404) {
      return {
        ok: false,
        error: {
          kind: 'unsupported_region',
          message: 'Solar imagery is not available for this location.',
          status: 404,
        },
      };
    }
    return asError(result);
  }
  return { ok: true, data: normalize(result.data) };
}
