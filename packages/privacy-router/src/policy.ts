/**
 * Privacy-routing policy — YAML parse + zod validation.
 *
 * The policy is the single source of truth for which task categories and
 * field prefixes escalate to which sensitivity tier, and which cloud
 * providers are approved. Mirrors the LITFIN
 * `privacy-routing-policy.yaml`, re-skinned to mining.
 *
 * Loading YAML from disk is the caller's concern (no `fs`, no
 * `process.env` in this leaf). `parsePrivacyPolicyYaml(text)` accepts the
 * raw YAML string; `DEFAULT_PRIVACY_POLICY` is the in-code fallback.
 */

import { load as yamlLoad } from 'js-yaml';
import { z } from 'zod';
import type { DataClassification, TaskCategory } from './types.js';

const classificationSchema = z.enum([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
]);

const approvedProviderSchema = z.enum(['claude', 'openai']);

/** Zod schema for the validated, normalised policy. */
export const privacyPolicySchema = z.object({
  version: z.string().min(1),
  jurisdiction: z.string().min(1),
  /** task category -> minimum classification. */
  taskCategoryClassification: z.record(z.string(), classificationSchema),
  /** field-path prefixes that force RESTRICTED. */
  restrictedFieldPrefixes: z.array(z.string().min(1)),
  /** ordered approved cloud providers (first is the default). */
  approvedCloudProviders: z.array(approvedProviderSchema).min(1),
});

export type PrivacyPolicy = Readonly<{
  version: string;
  jurisdiction: string;
  taskCategoryClassification: Readonly<
    Partial<Record<TaskCategory, DataClassification>>
  >;
  restrictedFieldPrefixes: ReadonlyArray<string>;
  approvedCloudProviders: ReadonlyArray<'claude' | 'openai'>;
}>;

/**
 * In-code default policy. Tanzania BOT Act / PDPA aligned, re-skinned to
 * mining task categories. The shipped `privacy-routing-policy.yaml`
 * mirrors this; the YAML is the operator-editable source of truth.
 */
export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = Object.freeze({
  version: '1.0.0',
  jurisdiction: 'United Republic of Tanzania',
  taskCategoryClassification: Object.freeze({
    // PUBLIC: marketing, teaching, public disclosures
    learning_teaching: 'PUBLIC',
    marketplace_listing_copy: 'PUBLIC',
    public_disclosure: 'PUBLIC',
    blog_generation: 'PUBLIC',
    // INTERNAL: platform ops, aggregates, forecasts
    platform_insight: 'INTERNAL',
    production_forecast: 'INTERNAL',
    data_aggregation: 'INTERNAL',
    batch_processing: 'INTERNAL',
    // CONFIDENTIAL: owner-facing financial / licence / payout work
    royalty_assessment: 'CONFIDENTIAL',
    licence_review: 'CONFIDENTIAL',
    payout_narrative: 'CONFIDENTIAL',
    treasury_analysis: 'CONFIDENTIAL',
    workforce_advisory: 'CONFIDENTIAL',
    assay_interpretation: 'CONFIDENTIAL',
    document_extraction: 'CONFIDENTIAL',
    // RESTRICTED: raw compliance / sanctions / autonomous computer use
    compliance_investigation: 'RESTRICTED',
    sanctions_screening: 'RESTRICTED',
    computer_use: 'RESTRICTED',
  } satisfies Partial<Record<TaskCategory, DataClassification>>),
  restrictedFieldPrefixes: Object.freeze([
    'compliance.',
    'sanctions.',
    'investigation.',
    'kyc.raw',
    'beneficial_owner.raw',
  ]),
  approvedCloudProviders: Object.freeze(['claude', 'openai'] as const),
});

/**
 * Parse + validate a privacy-routing policy from YAML text. Accepts the
 * snake_case YAML key shape and normalises to the camelCase
 * {@link PrivacyPolicy}. Throws a descriptive `Error` on malformed input.
 */
export function parsePrivacyPolicyYaml(yamlText: string): PrivacyPolicy {
  let raw: unknown;
  try {
    raw = yamlLoad(yamlText);
  } catch (error) {
    throw new Error(
      `privacy-router: failed to parse policy YAML: ${(error as Error).message}`,
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('privacy-router: policy YAML must be a mapping');
  }
  const doc = raw as Record<string, unknown>;

  // Accept both snake_case (YAML convention) and camelCase keys.
  const normalised = {
    version: doc.version ?? doc.Version,
    jurisdiction: doc.jurisdiction,
    taskCategoryClassification:
      doc.task_category_classification ?? doc.taskCategoryClassification ?? {},
    restrictedFieldPrefixes:
      doc.restricted_field_prefixes ?? doc.restrictedFieldPrefixes ?? [],
    approvedCloudProviders:
      doc.approved_cloud_providers ?? doc.approvedCloudProviders ?? [],
  };

  const parsed = privacyPolicySchema.safeParse(normalised);
  if (!parsed.success) {
    throw new Error(
      `privacy-router: invalid policy: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }

  return Object.freeze({
    version: parsed.data.version,
    jurisdiction: parsed.data.jurisdiction,
    taskCategoryClassification: Object.freeze(
      parsed.data.taskCategoryClassification as Partial<
        Record<TaskCategory, DataClassification>
      >,
    ),
    restrictedFieldPrefixes: Object.freeze([
      ...parsed.data.restrictedFieldPrefixes,
    ]),
    approvedCloudProviders: Object.freeze([
      ...parsed.data.approvedCloudProviders,
    ]),
  });
}
