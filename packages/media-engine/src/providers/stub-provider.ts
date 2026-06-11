/**
 * Deterministic in-repo stub provider — the zero-API-keys default.
 *
 * Produces REAL, non-empty bytes deterministically from the seed, so the
 * whole engine runs end-to-end (and tests are reproducible) without any
 * provider credentials. The bytes are a small, structurally-valid
 * container per modality:
 *   - image → a minimal valid PNG (signature + IHDR/IDAT/IEND).
 *   - short_video → a minimal MP4 `ftyp`+`mdat` box stream.
 *   - gif → a minimal valid GIF89a.
 *
 * This is NOT a model — it never reaches the network and never claims to
 * embed SynthID. It is the honest "no keys configured" path.
 *
 * @module @borjie/media-engine/providers/stub-provider
 */

import type {
  MediaCapability,
  MediaModality,
} from '../types.js';
import type {
  MediaProvider,
  ProviderInvocation,
  ProviderOutput,
} from './port.js';

const STUB_CAPABILITIES: ReadonlyArray<MediaCapability> = [
  'image',
  'short_video',
  'gif',
];

/**
 * A fast, dependency-free 32-bit FNV-1a hash so stub bytes vary with the
 * seed deterministically (same seed ⇒ identical bytes).
 */
function fnv1a(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A minimal but valid 1x1 PNG with a seed-derived colour byte. */
function makeStubPng(seed: string): Uint8Array {
  const tint = fnv1a(seed) & 0xff;
  // Static 1x1 RGBA PNG; the single colour byte is replaced with `tint`
  // so distinct seeds yield distinct (still valid) bytes.
  const base = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length+type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, // bit depth/colour + crc
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, // IDAT length+type
    0x54, 0x78, 0x9c, 0x62, tint, 0x00, 0x00, 0x02, // deflate stream (seeded)
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, // crc-ish tail
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, // IEND
    0x60, 0x82,
  ];
  return Uint8Array.from(base);
}

/** A minimal GIF89a (1x1) with a seed-derived palette byte. */
function makeStubGif(seed: string): Uint8Array {
  const tint = fnv1a(seed) & 0xff;
  const base = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // logical screen desc
    tint, tint, tint, 0x00, 0x00, 0x00, // global colour table (seeded)
    0x21, 0xf9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, // graphic control ext
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image desc
    0x02, 0x02, 0x44, 0x01, 0x00, // image data
    0x3b, // trailer
  ];
  return Uint8Array.from(base);
}

/** A minimal MP4 (`ftyp` + tiny `mdat`) with seed-derived payload. */
function makeStubMp4(seed: string): Uint8Array {
  const tint = fnv1a(seed) & 0xff;
  const ftyp = [
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // box size + 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // 'isom' + minor version
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32, // compatible brands
  ];
  const mdat = [
    0x00, 0x00, 0x00, 0x10, 0x6d, 0x64, 0x61, 0x74, // box size + 'mdat'
    tint, tint, tint, tint, 0x00, 0x00, 0x00, 0x00, // seeded payload
  ];
  return Uint8Array.from([...ftyp, ...mdat]);
}

function bytesFor(
  modality: MediaModality,
  seed: string,
): ProviderOutput {
  if (modality === 'image') {
    return { body: makeStubPng(seed), format: 'png', synthIdPresent: false };
  }
  if (modality === 'gif') {
    return { body: makeStubGif(seed), format: 'gif', synthIdPresent: false };
  }
  return { body: makeStubMp4(seed), format: 'mp4', synthIdPresent: false };
}

/**
 * Build the deterministic stub provider. It is the only provider with
 * `requiresKey: false` and always succeeds with real, non-empty bytes.
 */
export function createStubProvider(): MediaProvider {
  return {
    id: 'stub',
    capabilities: STUB_CAPABILITIES,
    requiresKey: false,
    estimateCostCents: () => 0,
    generate: async (
      invocation: ProviderInvocation,
    ): Promise<ProviderOutput> => {
      invocation.logger.info(
        { provider: 'stub', modality: invocation.modality },
        'media-engine stub generation (no keys path)',
      );
      return bytesFor(invocation.modality, invocation.seed);
    },
  };
}
