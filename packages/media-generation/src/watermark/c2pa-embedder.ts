/**
 * C2PA content-credentials embedder.
 *
 * Embeds an invisible C2PA manifest into the artifact bytes, carrying:
 *   - recipe_id, recipe_version
 *   - audit_hash
 *   - prompt_hash
 *   - model_id, model_provider
 *   - generated_at
 * signed by the tenant's audit secret.
 *
 * The C2PA library landscape in 2026 has multiple back-ends
 * (`c2pa-node`, the Rust `c2patool` CLI, Adobe's hosted CAI service).
 * To keep the package dependency-free at install time and dependable
 * in CI, this module ships a **manifest-only** implementation: the
 * canonical manifest is computed and serialized as a JSON sidecar
 * appended to the artifact bytes (with a recognisable header).
 * Production wires a true C2PA back-end via the `embedFn` parameter.
 *
 * Pure logic + optional injection point. No network I/O.
 *
 * @module @borjie/media-generation/watermark/c2pa-embedder
 */

import { createHash } from 'node:crypto';
import type { MediaProvenance } from '../types.js';

export interface C2paManifest {
  readonly version: '1.4';
  readonly claim_generator: 'borjie/media-generation';
  readonly title: string;
  readonly assertions: ReadonlyArray<{
    readonly label: string;
    readonly data: Readonly<Record<string, unknown>>;
  }>;
  readonly signature: {
    readonly algorithm: 'sha256';
    readonly value: string;
  };
}

export interface BuildManifestArgs {
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audit_hash: string;
  readonly checksum: string;
  readonly provenance: MediaProvenance;
  readonly generated_at: string;
  readonly tenant_secret?: string;
}

export function buildC2paManifest(args: BuildManifestArgs): C2paManifest {
  const promptHash = createHash('sha256')
    .update(args.provenance.prompt_text)
    .digest('hex');
  const manifest = {
    version: '1.4' as const,
    claim_generator: 'borjie/media-generation' as const,
    title: `${args.recipe_id}@${args.recipe_version}`,
    assertions: [
      {
        label: 'c2pa.actions',
        data: {
          actions: [
            {
              action: 'c2pa.created',
              softwareAgent: 'borjie/media-generation',
              when: args.generated_at,
              parameters: {
                recipe_id: args.recipe_id,
                recipe_version: args.recipe_version,
                model_provider: args.provenance.model_provider,
                model_id: args.provenance.model_id,
                model_version: args.provenance.model_version,
                prompt_hash: promptHash,
                seed: args.provenance.seed,
                audit_hash: args.audit_hash,
                checksum: args.checksum,
              },
            },
          ],
        },
      },
      {
        label: 'borjie.brand_credentials',
        data: {
          brand: 'borjie',
          recipe_id: args.recipe_id,
          recipe_version: args.recipe_version,
          generated_at: args.generated_at,
          audit_hash: args.audit_hash,
        },
      },
    ],
    signature: {
      algorithm: 'sha256' as const,
      value: createHash('sha256')
        .update(
          [
            args.audit_hash,
            args.checksum,
            promptHash,
            args.tenant_secret ?? '',
          ].join('|'),
        )
        .digest('hex'),
    },
  } as const;
  return manifest;
}

const C2PA_SIDE_CHANNEL_HEADER = '\nC2PA-MANIFEST-v1.4:';

export interface EmbedArgs {
  readonly bytes: Buffer;
  readonly manifest: C2paManifest;
  readonly embedFn?: (b: Buffer, m: C2paManifest) => Buffer;
}

/**
 * Embed the manifest into the artifact bytes. The default
 * implementation appends a JSON sidecar header to the trailing bytes —
 * sufficient for downstream verification (`extractC2paManifest`).
 * Production wires a true c2pa-node `embedFn` here.
 */
export function embedC2paManifest(args: EmbedArgs): Buffer {
  if (args.embedFn) return args.embedFn(args.bytes, args.manifest);
  const sidecar = Buffer.from(
    `${C2PA_SIDE_CHANNEL_HEADER}${JSON.stringify(args.manifest)}\n`,
    'utf-8',
  );
  return Buffer.concat([args.bytes, sidecar]);
}

/**
 * Extract a previously-embedded manifest. Returns `null` when the
 * artifact carries no sidecar header.
 */
export function extractC2paManifest(bytes: Buffer): C2paManifest | null {
  const text = bytes.toString('utf-8');
  const idx = text.lastIndexOf(C2PA_SIDE_CHANNEL_HEADER);
  if (idx === -1) return null;
  const json = text.slice(idx + C2PA_SIDE_CHANNEL_HEADER.length).trim();
  try {
    return JSON.parse(json) as C2paManifest;
  } catch {
    return null;
  }
}
