/**
 * k6 load test — POST /api/v1/mining/brain/vision-turn.
 *
 * Multimodal Brain turn for the workforce-mobile Photo Advisor screen.
 * The route accepts a base64 image (≤ 10 MB) + prompt + location +
 * language. We send a synthetic 100 KB image so we exercise the
 * payload parsing + size guard + rate limiter path without spending
 * vision-model dollars (the orchestrator currently returns 503
 * `BACKEND_VISION_UNAVAILABLE` until the multimodal API is wired —
 * that 503 is the documented contract, see brain-vision.hono.ts).
 *
 * SLO: p95 < 5s (vision is the slowest endpoint by design).
 *
 * Auth: Supabase bearer via `K6_AUTH_TOKEN`.
 *
 * Run:
 *   K6_API_URL=http://localhost:4000 \
 *   K6_AUTH_TOKEN=ey... \
 *   k6 run tests/load/photo-vision.k6.ts
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

import { url, buildOptions, LOADTEST_RUN_ID } from './lib/config';
import { authHeaders, HAS_AUTH_TOKEN } from './lib/auth';

export const options = buildOptions('mining.vision');

// ─── Synthetic image ─────────────────────────────────────────────────
// 100 KB target. Base64 inflates raw bytes by ≈ 4/3, so we need
// ~75 KB of binary → encoded as ~100 KB string. We do NOT ship a
// real JPEG — the route validates `mimeType` and `sizeBytes` from
// the request body, and only loads the bytes when the orchestrator
// finally runs (currently 503'd out). Generating the payload once
// at module init keeps every iteration's CPU on the network, not on
// base64 encoding.

function buildSyntheticImage(): { readonly base64: string; readonly sizeBytes: number } {
  // 75 KB of random-ish data. Math.random()-derived so different
  // VUs do not all submit byte-identical payloads (any cache layer
  // would otherwise mask the real network cost).
  const TARGET_BINARY_BYTES = 75_000;
  const chunks: string[] = [];
  // Build in 1 KB chunks of repeated base64-safe chars; the result
  // is `TARGET_BINARY_BYTES * 4 / 3` chars long.
  const ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // 1366 chars ≈ 1024 binary bytes (we just want length, not validity
  // beyond base64 alphabet — the server will not decode unless 200).
  const CHUNK_LEN = 1366;
  const CHUNK_COUNT = Math.ceil((TARGET_BINARY_BYTES * 4) / 3 / CHUNK_LEN);
  for (let i = 0; i < CHUNK_COUNT; i++) {
    let chunk = '';
    for (let j = 0; j < CHUNK_LEN; j++) {
      chunk += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    chunks.push(chunk);
  }
  const base64 = chunks.join('');
  // Approximate decoded byte size from base64 length.
  const sizeBytes = Math.floor((base64.length * 3) / 4);
  return { base64, sizeBytes };
}

const IMAGE_PAYLOAD = buildSyntheticImage();

const PROMPTS: ReadonlyArray<string> = [
  'Identify the mineral in this rock sample.',
  'Je, hii ni dhahabu au kioo?', // sw — "is this gold or quartz?"
  'Are there any safety hazards visible?',
  'Describe the visible vein structure.',
  'Pita kwenye picha — orodhesha hatari.', // sw — "scan the photo, list hazards"
];

function pickPrompt(): string {
  const idx = Math.floor(Math.random() * PROMPTS.length);
  return PROMPTS[idx] ?? PROMPTS[0]!;
}

// ─── Iteration body ──────────────────────────────────────────────────

export default function visionTurnIteration(): void {
  // Always emit the body shape so we exercise parse + zod even
  // without auth (we will get 401 first; that's fine — it measures
  // the auth middleware cost which is part of the SLO budget).
  const body = JSON.stringify({
    image: {
      base64: IMAGE_PAYLOAD.base64,
      mimeType: 'image/jpeg',
      sizeBytes: IMAGE_PAYLOAD.sizeBytes,
    },
    prompt: pickPrompt(),
    location: {
      latitude: -6.7924, // Dar es Salaam-ish
      longitude: 39.2083,
      accuracy: 10,
    },
    language: 'sw',
  });

  const res = http.post(
    url('/api/v1/mining/brain/vision-turn'),
    body,
    {
      headers: authHeaders({
        'X-Loadtest-Run-Id': LOADTEST_RUN_ID,
      }),
      tags: { name: 'mining.vision' },
      timeout: '30s',
    },
  );

  if (HAS_AUTH_TOKEN) {
    check(res, {
      // 200 (when orchestrator is wired), 503 (current contract),
      // or 429 (rate-limit). Anything else is a real fault.
      'status is 200, 429 or 503': (r) =>
        r.status === 200 || r.status === 429 || r.status === 503,
      'response is JSON': (r) => {
        try {
          const j = r.json();
          return j !== null && typeof j === 'object';
        } catch {
          return false;
        }
      },
    });
  } else {
    check(res, {
      'status is 401 (no token)': (r) => r.status === 401,
    });
  }

  sleep(1);
}
