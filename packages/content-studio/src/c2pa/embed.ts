/**
 * C2PA manifest embedding.
 *
 * Two strategies:
 *
 *   1. SIDECAR (default, always available) — write the manifest as a
 *      `.c2pa.json` file alongside the asset. C2PA spec §10.2 explicitly
 *      sanctions sidecar manifests for formats that don't support
 *      embedded XMP/JUMBF.
 *
 *   2. EMBEDDED (opt-in, requires `c2pa-node`) — write the JUMBF box
 *      into the asset's container (JPEG APP11, PNG ancillary, MP4 box).
 *      `c2pa-node` is declared as an OPTIONAL peer dependency so this
 *      package type-checks and tests cleanly when the package is absent.
 *      At runtime we attempt a dynamic import; failure (missing package
 *      OR loader error from native bindings) falls back to sidecar.
 *
 * Pure orchestration. Returns the BYTES (sidecar or modified asset) —
 * the caller chooses where to persist (file system, S3, blob store).
 */

import type { C2paManifest } from '../types.js';
import { canonicalize } from './signer.js';

/**
 * Structural shape of the `c2pa-node` surface we depend on. The real
 * SDK is wider — we keep only what `embedManifest()` calls. This lets
 * `tsc --noEmit` pass even when the peer dep is not installed.
 */
interface C2paNodeLike {
  /**
   * Legacy / convenience shape some forks expose: a direct functional
   * embed taking (asset, manifestJson, mime) and returning new bytes.
   */
  embed?: (
    asset: Uint8Array,
    manifestJson: string,
    mime: string,
  ) => Promise<Uint8Array>;
  /**
   * Modern factory shape exposed by `c2pa-node@>=0.5`. Returns a client
   * with `sign({ asset, manifest })` that emits a signed asset buffer.
   */
  createC2pa?: () => {
    sign: (input: {
      asset: { mimeType: string; buffer: Uint8Array };
      manifest: unknown;
    }) => Promise<{ signedAsset: { buffer: Uint8Array } }>;
  };
}

export type EmbedStrategy = 'sidecar' | 'embedded';

export interface EmbedRequest {
  readonly asset: Uint8Array;
  readonly assetMime: string; // e.g. 'image/jpeg'
  readonly manifest: C2paManifest;
  readonly strategy?: EmbedStrategy;
}

export interface EmbedResult {
  readonly strategy: EmbedStrategy;
  /** The asset bytes — modified when embedded, unchanged when sidecar. */
  readonly assetBytes: Uint8Array;
  /** Non-null when sidecar: the bytes of the `.c2pa.json` sidecar. */
  readonly sidecarBytes: Uint8Array | null;
  /** Suggested sidecar filename suffix (e.g. `.c2pa.json`). */
  readonly sidecarSuffix: string | null;
}

const TEXT_ENCODER = new TextEncoder();

export async function embedManifest(req: EmbedRequest): Promise<EmbedResult> {
  const strategy: EmbedStrategy = req.strategy ?? 'sidecar';

  if (strategy === 'sidecar') {
    const sidecarBytes = TEXT_ENCODER.encode(canonicalize(req.manifest));
    return {
      strategy: 'sidecar',
      assetBytes: req.asset,
      sidecarBytes,
      sidecarSuffix: '.c2pa.json',
    };
  }

  // Embedded — try the optional c2pa-node module. If unavailable, fall
  // back to sidecar (callers can detect via the returned `strategy`
  // field). We try the modern factory API first, then the legacy
  // `embed()` shape some forks still expose.
  const modified = await tryEmbedWithC2paNode(req);
  if (modified) {
    return {
      strategy: 'embedded',
      assetBytes: modified,
      sidecarBytes: null,
      sidecarSuffix: null,
    };
  }

  // Fallback: sidecar with the strategy field flipped back so callers know.
  const sidecarBytes = TEXT_ENCODER.encode(canonicalize(req.manifest));
  return {
    strategy: 'sidecar',
    assetBytes: req.asset,
    sidecarBytes,
    sidecarSuffix: '.c2pa.json',
  };
}

/**
 * Cached module loader for `c2pa-node`. Returns `null` when the package
 * is not installed (most common path) or when the native binding fails
 * to load on the current platform.
 *
 * The `// @ts-expect-error` is necessary because `c2pa-node` is an
 * OPTIONAL peer dep — TypeScript cannot resolve the specifier when the
 * package is absent, but the runtime swallows the error in the catch.
 */
let cachedC2paNode: C2paNodeLike | null | undefined;

async function loadC2paNode(): Promise<C2paNodeLike | null> {
  if (cachedC2paNode !== undefined) return cachedC2paNode;
  try {
    // c2pa-node is installed (package.json deps). When absent in a
    // consumer with peerDependenciesMeta.optional=true, the dynamic
    // import throws and we fall through to the null branch below.
    const mod = (await import('c2pa-node')) as unknown as C2paNodeLike;
    cachedC2paNode = mod ?? null;
    return cachedC2paNode;
  } catch {
    cachedC2paNode = null;
    return null;
  }
}

async function tryEmbedWithC2paNode(req: EmbedRequest): Promise<Uint8Array | null> {
  const mod = await loadC2paNode();
  if (!mod) return null;
  const manifestJson = canonicalize(req.manifest);

  // 1. Modern factory API (c2pa-node@>=0.5).
  if (typeof mod.createC2pa === 'function') {
    try {
      const client = mod.createC2pa();
      const result = await client.sign({
        asset: { mimeType: req.assetMime, buffer: req.asset },
        manifest: JSON.parse(manifestJson) as unknown,
      });
      const out = result?.signedAsset?.buffer;
      if (out && out.length > 0) return out;
    } catch {
      // Modern API failed (signing key missing, native binding error,
      // etc) — fall through to the legacy shape and finally sidecar.
    }
  }

  // 2. Legacy direct `embed()` shape.
  if (typeof mod.embed === 'function') {
    try {
      const out = await mod.embed(req.asset, manifestJson, req.assetMime);
      if (out && out.length > 0) return out;
    } catch {
      // Legacy API failed — caller falls back to sidecar.
    }
  }

  return null;
}

/**
 * Test-only: reset the cached module so a test can install a stub and
 * have it picked up on the next call. NOT part of the public surface.
 */
export function __resetC2paNodeCacheForTests(value?: C2paNodeLike | null): void {
  cachedC2paNode = value === undefined ? undefined : value;
}

/**
 * Extract a manifest from an asset + optional sidecar. Returns null
 * when no manifest is found.
 */
export function extractSidecarManifest(sidecarBytes: Uint8Array): C2paManifest | null {
  try {
    const text = new TextDecoder().decode(sidecarBytes);
    const parsed = JSON.parse(text) as C2paManifest;
    if (!parsed || typeof parsed !== 'object' || !('claimGenerator' in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
