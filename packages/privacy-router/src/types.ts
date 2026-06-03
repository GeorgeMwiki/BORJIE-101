/**
 * Privacy-aware AI routing — shared types.
 *
 * Ported from LITFIN `src/core/security/privacy-router.ts` and re-skinned
 * for the Borjie mining-estate OS. Routes an inference request to a
 * provider based on the data-sensitivity tier of its payload, enforcing
 * Tanzania BOT Act / PDPA data-residency rules.
 *
 * Wire-agnostic: PII stripping and local-endpoint health are injected
 * ports, so this package is a pure leaf with no `node:*`, no `fetch`, and
 * no `process.env` reads.
 */

/** Four-tier data sensitivity classification. */
export type DataClassification =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'RESTRICTED';

/** Severity order, lowest to highest. Higher index = more restrictive. */
export const CLASSIFICATION_ORDER: ReadonlyArray<DataClassification> = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
];

/**
 * Mining-estate task categories. Each maps to a minimum classification in
 * the routing policy. Re-skinned from LITFIN's lending taxonomy:
 * royalty / licence / payout / assay / treasury / marketplace replace
 * credit / loan / CRB.
 */
export type TaskCategory =
  // PUBLIC
  | 'learning_teaching'
  | 'marketplace_listing_copy'
  | 'public_disclosure'
  | 'blog_generation'
  // INTERNAL
  | 'platform_insight'
  | 'production_forecast'
  | 'data_aggregation'
  | 'batch_processing'
  // CONFIDENTIAL
  | 'royalty_assessment'
  | 'licence_review'
  | 'payout_narrative'
  | 'treasury_analysis'
  | 'workforce_advisory'
  | 'assay_interpretation'
  | 'document_extraction'
  // RESTRICTED
  | 'compliance_investigation'
  | 'sanctions_screening'
  | 'computer_use';

/** Approved cloud providers that meet Tanzania PDPA processing standards. */
export type ApprovedCloudProvider = 'claude' | 'openai';

/** Local inference endpoint (Ollama or compatible). */
export type LocalProvider = 'ollama';

/** All provider identities the router can select. */
export type PrivacyProvider = ApprovedCloudProvider | LocalProvider;

/** Terminal routing target, including the deny outcome. */
export type RoutingEndpoint = PrivacyProvider | 'DENIED';

/**
 * Result of stripping PII from a payload. `mappings` carries the reversible
 * token-to-original substitutions so a caller can restore the response.
 * Kept as a plain object (not a Map) so results stay JSON-serialisable and
 * immutable.
 */
export interface StripResult {
  readonly stripped: string;
  readonly mappings: Readonly<Record<string, string>>;
}

/**
 * Injected PII-stripping port. The composition root wires the real
 * `data-protection` stripper; tests wire a deterministic stub.
 */
export interface PiiStripperPort {
  readonly stripPii: (
    text: string,
    knownNames?: ReadonlyArray<string>,
  ) => StripResult;
  /** Cheap content scan: does the text contain any PII pattern? */
  readonly containsPii: (text: string) => boolean;
}

/**
 * Injected local-endpoint health port. Returns true when the on-prem
 * model (Ollama or compatible) is reachable. The router calls this only
 * for RESTRICTED routing; everything else stays synchronous.
 */
export interface LocalEndpointHealthPort {
  readonly isHealthy: () => Promise<boolean>;
}

/** Field-classification lookup port (maps a field path to its tier). */
export interface FieldClassifierPort {
  readonly classifyField: (fieldPath: string) => DataClassification;
}

/** Input to a single routing decision. */
export interface PrivacyRoutingRequest {
  /** The text payload to be sent to a provider. */
  readonly text: string;
  /** Explicit task category, if known from the task router. */
  readonly taskCategory?: TaskCategory;
  /** Field paths present in the payload (for classification lookup). */
  readonly fieldPaths?: ReadonlyArray<string>;
  /** Explicit classification override (skips auto-detection). */
  readonly classificationOverride?: DataClassification;
  /** Known names to strip (forwarded to the PII stripper). */
  readonly knownNames?: ReadonlyArray<string>;
  /** Preferred cloud provider when cloud is allowed. */
  readonly preferredProvider?: ApprovedCloudProvider;
}

/** Result returned by every routing decision. */
export interface PrivacyRoutingResult {
  readonly endpoint: RoutingEndpoint;
  readonly piiStripped: boolean;
  readonly strippedFields: ReadonlyArray<string>;
  readonly classification: DataClassification;
  readonly reason: string;
  readonly timestamp: string;
  /** Token mappings for response restoration when PII was stripped. */
  readonly piiMappings?: Readonly<Record<string, string>>;
  /** The (possibly stripped) text to send to the provider. */
  readonly processedText?: string;
}

/** A single audit entry for a routing decision. PII is never recorded. */
export interface PrivacyAuditEntry {
  readonly timestamp: string;
  readonly classification: DataClassification;
  readonly endpoint: RoutingEndpoint;
  readonly piiStripped: boolean;
  readonly strippedFieldCount: number;
  readonly taskCategory: TaskCategory | 'unknown';
  readonly reason: string;
}
