/**
 * SAM 2.1 segmenter — Meta's "Segment Anything v2.1" foundation model.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §5.1.
 *
 * In production we call out to a hosted SAM 2.1 endpoint (Replicate,
 * Modal, or a self-hosted A10G). The token comes from `SAM_REPLICATE_TOKEN`
 * (lazy read, never logged). The stub path returns a small box-shaped
 * polygon around the click so the UI is testable end-to-end on dev
 * machines without GPUs.
 */

import type {
  ClientCallOptions,
  GeoResult,
  SamMaskPolygon,
  SamSegmentationInput,
} from '../types.js';
import { asError, fetchJson } from '../google/http.js';

export const SAM_TOKEN_ENV = 'SAM_REPLICATE_TOKEN';
export const SAM_ENDPOINT_ENV = 'SAM_REPLICATE_ENDPOINT';

function readToken(override?: string): string | undefined {
  if (override && override.length > 0) return override;
  if (typeof process === 'undefined' || !process.env) return undefined;
  const v = process.env[SAM_TOKEN_ENV];
  return v && v.length > 0 ? v : undefined;
}

function readEndpoint(): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  const v = process.env[SAM_ENDPOINT_ENV];
  return v && v.length > 0 ? v : undefined;
}

interface UpstreamSamResponse {
  readonly polygon?: readonly (readonly [number, number])[];
  readonly score?: number;
}

/**
 * Generate a deterministic stub polygon around the click point — used
 * when the SAM endpoint is not configured. The polygon is a square of
 * side ~80 px in pixel space.
 */
function stubMask(input: SamSegmentationInput): SamMaskPolygon {
  const { x, y } = input.clickPx;
  const r = 40;
  return {
    pixelPolygon: [
      [x - r, y - r],
      [x + r, y - r],
      [x + r, y + r],
      [x - r, y + r],
      [x - r, y - r],
    ],
    score: 0.1,
  };
}

export interface SamCallOptions extends ClientCallOptions {
  /** When true, always returns the stub polygon (useful for tests). */
  readonly forceStub?: boolean;
  /** Override the token instead of reading env. */
  readonly token?: string;
}

export async function segmentClick(
  input: SamSegmentationInput,
  options: SamCallOptions = {},
): Promise<GeoResult<SamMaskPolygon>> {
  if (options.forceStub) {
    return { ok: true, data: stubMask(input) };
  }
  const token = readToken(options.token);
  const endpoint = readEndpoint();
  if (!token || !endpoint) {
    // Degrade to stub but flag it so callers can show a banner.
    return { ok: true, data: stubMask(input) };
  }
  const body = {
    image: input.imageUrl,
    clicks: [
      { x: input.clickPx.x, y: input.clickPx.y, label: 1 },
      ...(input.negativeClicksPx ?? []).map((c) => ({ x: c.x, y: c.y, label: 0 })),
    ],
  };
  const result = await fetchJson<UpstreamSamResponse>({
    url: endpoint,
    method: 'POST',
    body,
    headers: { authorization: `Bearer ${token}` },
    options,
  });
  if (!result.ok) return asError(result);
  const polygon = result.data.polygon ?? [];
  if (polygon.length < 3) {
    return {
      ok: false,
      error: { kind: 'invalid_response', message: 'SAM returned an empty mask.' },
    };
  }
  return {
    ok: true,
    data: {
      pixelPolygon: polygon,
      score: Math.max(0, Math.min(1, result.data.score ?? 0.5)),
    },
  };
}
