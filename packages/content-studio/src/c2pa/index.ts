/**
 * C2PA pipeline barrel — provenance + signing + embedding + verification
 * + visible watermark.
 *
 * Wires up to satisfy CA SB 942 (Aug 2, 2026) + EU AI Act Art.50
 * disclosure for AI-generated content.
 */

export { buildC2paManifest, type BuildManifestArgs } from './attestation.js';

export {
  signManifest,
  verifyManifest,
  canonicalize,
  canonicalHash,
  loadSigningKeyFromEnv,
  DEFAULT_DEV_KEY,
  type SigningKey,
  type SignedManifest,
  type VerifyResult,
  type VerifyDenyReason,
} from './signer.js';

export {
  embedManifest,
  extractSidecarManifest,
  type EmbedStrategy,
  type EmbedRequest,
  type EmbedResult,
} from './embed.js';

export {
  fullyVerify,
  type FullVerifyRequest,
  type FullVerifyResult,
} from './verify.js';

export {
  buildVisibleWatermark,
  type WatermarkOptions,
  type VisibleWatermark,
} from './visible-watermark.js';
