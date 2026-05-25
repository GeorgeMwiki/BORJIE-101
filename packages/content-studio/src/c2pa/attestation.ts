/**
 * C2PA (Coalition for Content Provenance and Authenticity) attestation.
 *
 * Pure function that builds a C2PA-style manifest JSON for AI-generated
 * content. We do NOT sign here — real signing requires a hardware token or
 * KMS-backed signer (e.g. Adobe Content Authenticity, Truepic) and lives in
 * an external micro-service. The `claimSignature` field is a deterministic
 * placeholder so downstream consumers can structurally validate the
 * manifest in tests + dev environments.
 *
 * Reference:
 *   - C2PA 1.4 spec: https://c2pa.org/specifications/specifications/1.4/
 *   - Research:      .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§"10 concrete things to build" #7)
 */

import { createHash } from 'node:crypto';
import type { C2paAssertion, C2paIngredient, C2paManifest } from '../types.js';

const STUDIO_VERSION = '0.1.0';
const CLAIM_GENERATOR_ID = `borjie.content-studio/${STUDIO_VERSION}`;

export interface BuildManifestArgs {
  readonly title: string;
  readonly format: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly tenantId: string;
  readonly seed: number;
  readonly loraIds: ReadonlyArray<string>;
  readonly createdAtIso: string;
  readonly ingredients?: ReadonlyArray<C2paIngredient>;
  readonly extraAssertions?: ReadonlyArray<C2paAssertion>;
}

export function buildC2paManifest(args: BuildManifestArgs): C2paManifest {
  const promptHash = sha256Hex(args.prompt);
  const instanceId = sha256Hex(
    [
      args.providerId,
      args.modelId,
      promptHash,
      args.seed,
      args.tenantId,
      args.createdAtIso,
    ].join('|'),
  ).slice(0, 32);

  const assertions: C2paAssertion[] = [
    {
      label: 'c2pa.actions',
      data: {
        actions: [
          {
            action: 'c2pa.created',
            softwareAgent: CLAIM_GENERATOR_ID,
            when: args.createdAtIso,
          },
        ],
      },
    },
    {
      label: 'borjie.generation',
      data: {
        provider: args.providerId,
        model: args.modelId,
        promptSha256: promptHash,
        seed: args.seed,
        loraIds: [...args.loraIds],
        tenantId: args.tenantId,
      },
    },
    ...(args.extraAssertions ?? []),
  ];

  const signaturePayload = [
    CLAIM_GENERATOR_ID,
    instanceId,
    promptHash,
    args.providerId,
    args.modelId,
    args.tenantId,
  ].join('|');

  return {
    claimGenerator: CLAIM_GENERATOR_ID,
    claimGeneratorInfo: [{ name: 'borjie.content-studio', version: STUDIO_VERSION }],
    title: args.title,
    format: args.format,
    instanceId,
    assertions,
    ingredients: args.ingredients ?? [],
    claimSignature: `sha256:${sha256Hex(signaturePayload)}`,
    signedAtIso: args.createdAtIso,
  };
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
