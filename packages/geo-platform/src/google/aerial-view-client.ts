/**
 * Google Aerial View API client — photorealistic 3D flyovers.
 *
 * Docs: https://developers.google.com/maps/documentation/aerial-view/lookup-video
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §1.1.
 *
 * Endpoint:
 *   POST https://aerialview.googleapis.com/v1/videos:lookupVideo?key=...
 *
 * Returns either `PROCESSING` (caller should retry) or `ACTIVE` with
 * playable MP4 / WEBM URIs.
 */

import type {
  AerialViewLookupInput,
  AerialViewVideo,
  ClientCallOptions,
  GeoResult,
} from '../types.js';
import { asError, fetchJson, missingKeyError, readApiKey, withKey } from './http.js';

const BASE_URL = 'https://aerialview.googleapis.com/v1/videos:lookupVideo';

/** Raw upstream shape (only the fields we use). */
interface UpstreamAerialView {
  readonly name?: string;
  readonly uri?: string;
  readonly imageUri?: string;
  readonly state?: string;
  readonly mediaFormat?: string;
}

function normalize(raw: UpstreamAerialView): AerialViewVideo {
  const state = raw.state === 'ACTIVE' || raw.state === 'FAILED' ? raw.state : 'PROCESSING';
  const out: { -readonly [K in keyof AerialViewVideo]: AerialViewVideo[K] } = {
    name: raw.name ?? '',
    uri: raw.uri ?? '',
    state,
    mediaFormat:
      raw.mediaFormat === 'WEBM' || raw.mediaFormat === 'IMAGE' ? raw.mediaFormat : 'MP4',
  };
  if (raw.imageUri !== undefined) {
    out.imageUri = raw.imageUri;
  }
  return out;
}

export async function lookupAerialView(
  input: AerialViewLookupInput,
  options: ClientCallOptions = {},
): Promise<GeoResult<AerialViewVideo>> {
  const key = readApiKey(options.apiKey);
  if (!key) return missingKeyError();

  const body = {
    location: { latitude: input.lat, longitude: input.lng },
    ...(input.addressDescriptor ? { addressDescriptor: input.addressDescriptor } : {}),
  };

  const result = await fetchJson<UpstreamAerialView>({
    url: withKey(BASE_URL, key),
    method: 'POST',
    body,
    options,
  });

  if (!result.ok) return asError(result);
  return { ok: true, data: normalize(result.data) };
}
