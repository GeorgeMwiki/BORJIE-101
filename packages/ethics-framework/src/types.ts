/**
 * `@borjie/ethics-framework` — public types.
 *
 * Eight subsystems share a small set of cross-cutting types. Everything
 * is `readonly` end-to-end so callers cannot mutate audit-relevant
 * records (consent logs, AI decisions, dark-pattern detections,
 * surveillance registrations, accessibility checks).
 *
 * Key invariants encoded at the type boundary:
 *
 *  1. `ConsentRecord` is append-only — `recordConsent` returns a new
 *     record; `withdrawConsent` appends a new record with
 *     `granted: false`.
 *  2. Every `AutomatedDecisionDisclosure` is logged BEFORE the decision
 *     is enacted (GDPR Art 22 + EU AI Act Art 14).
 *  3. `SurveillanceConsent` is per-tenant per-device — when a tenant
 *     changes, prior consent does NOT carry over.
 *  4. `DarkPatternDetection.brignullType` is closed enum of 14 — the
 *     full Brignull (2010) taxonomy.
 *  5. `AccessibilityCheck.wcagSc` is a closed enum of WCAG 2.2 success
 *     criteria so we never silently widen the spec.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Jurisdictions
// ─────────────────────────────────────────────────────────────────────

/**
 * Jurisdictions the ethics framework knows about.
 *
 *  - `EU`     — GDPR umbrella (Member States + EEA)
 *  - `UK`     — UK GDPR + Data Protection Act 2018
 *  - `US`     — Federal floor (COPPA, FHA, Section 508)
 *  - `US-CA`  — California (adds CCPA/CPRA)
 *  - `ZA`     — Republic of South Africa (POPIA)
 *  - `TZ`     — Tanzania (Land Act 1999, Persons with Disabilities Act 2010)
 *  - `KE`     — Kenya (Rental Housing Act 2017, DPA 2019)
 *  - `UG`     — Uganda (Landlord & Tenant Act 2022)
 *  - `RW`     — Rwanda (Law 058/2021)
 *  - `NG`     — Nigeria (NDPA 2023)
 *  - `GLOBAL` — Catch-all for principles that apply everywhere
 *               (IEEE P7000, Asilomar, NIST RMF).
 */
export const JURISDICTIONS = [
  'GLOBAL',
  'EU',
  'UK',
  'US',
  'US-CA',
  'ZA',
  'TZ',
  'KE',
  'UG',
  'RW',
  'NG',
] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];
export const JurisdictionSchema = z.enum(JURISDICTIONS);

// ─────────────────────────────────────────────────────────────────────
// Principles registry
// ─────────────────────────────────────────────────────────────────────

/** Severity of a principle violation. */
export const ETHICS_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type EthicsSeverity = (typeof ETHICS_SEVERITIES)[number];
export const EthicsSeveritySchema = z.enum(ETHICS_SEVERITIES);

/**
 * The contexts a principle applies to. A principle may apply to many
 * contexts.
 */
export const ETHICS_CONTEXTS = [
  'ai-decision',
  'consent',
  'data-collection',
  'data-retention',
  'surveillance',
  'pricing',
  'eviction',
  'tenant-screening',
  'communication',
  'ui-design',
  'accessibility',
  'children',
  'vulnerable-population',
] as const;
export type EthicsContext = (typeof ETHICS_CONTEXTS)[number];
export const EthicsContextSchema = z.enum(ETHICS_CONTEXTS);

/**
 * A codified ethics principle. `evaluator` is optional — when present
 * it returns `null` if the principle is satisfied or a string reason
 * if violated. Principles without an evaluator are documentation-only
 * and surfaced to humans via dashboards.
 */
export interface EthicsPrinciple {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly jurisdiction: Jurisdiction;
  readonly severity: EthicsSeverity;
  readonly applicableContext: ReadonlyArray<EthicsContext>;
  /**
   * Returns null when the principle is satisfied; returns a violation
   * reason string when violated. Synchronous + pure.
   */
  readonly evaluator?: (input: unknown) => string | null;
}

/** A flagged violation of a principle. */
export interface EthicsViolation {
  readonly principleId: string;
  readonly context: EthicsContext;
  readonly severity: EthicsSeverity;
  readonly reason: string;
  readonly jurisdiction: Jurisdiction;
  readonly detectedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Consent
// ─────────────────────────────────────────────────────────────────────

/**
 * Scopes a consent record can apply to. Adding a new scope is a
 * semver-minor bump; consumers MUST handle unknown scopes safely.
 */
export const CONSENT_SCOPES = [
  'data-processing',
  'marketing',
  'analytics',
  'profiling',
  'cookies',
  'sms',
  'voice-recording',
  'video-recording',
  'biometric',
  'third-party-sharing',
  'cross-border-transfer',
  'automated-decision-making',
  'children-data',
  'sensor-monitoring',
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];
export const ConsentScopeSchema = z.enum(CONSENT_SCOPES);

export const CONSENT_CHANNELS = [
  'web',
  'mobile',
  'sms',
  'voice',
  'paper',
  'in-person',
  'api',
] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/**
 * One consent transition. Append-only. Withdrawal is a new record with
 * `granted: false`. Versions bump with policy/scope changes; reading
 * needs `currentVersion` to know if a refresh is required.
 */
export interface ConsentRecord {
  readonly subjectId: string;
  readonly scope: ConsentScope;
  readonly version: string;
  readonly channel: ConsentChannel;
  readonly jurisdiction: Jurisdiction;
  readonly granted: boolean;
  readonly recordedAt: string;
  /**
   * For minors: the verified adult subject id that granted consent on
   * the minor's behalf.
   */
  readonly grantedBy?: string;
  /** Optional withdrawal/grant reason — never auto-translated. */
  readonly reason?: string;
}

export interface ConsentStatus {
  readonly granted: boolean;
  readonly needsRefresh: boolean;
  /** When `granted=false || needsRefresh=true`. */
  readonly reason?: string;
  /** Latest record we found, if any. */
  readonly latestRecord?: ConsentRecord;
}

// ─────────────────────────────────────────────────────────────────────
// Vulnerable populations
// ─────────────────────────────────────────────────────────────────────

/** Factors that flag a subject as needing extra safeguards. */
export const VULNERABILITY_FACTORS = [
  'elderly',
  'disabled',
  'displaced',
  'minor',
  'victim-of-violence',
  'language-barrier',
  'low-literacy',
  'recent-bereavement',
  'pregnant',
  'caregiver-of-dependent',
  'refugee',
  'survivor-of-eviction',
] as const;
export type VulnerabilityFactor = (typeof VULNERABILITY_FACTORS)[number];
export const VulnerabilityFactorSchema = z.enum(VULNERABILITY_FACTORS);

export interface VulnerabilityFlag {
  readonly subjectId: string;
  readonly factors: ReadonlyArray<VulnerabilityFactor>;
  readonly jurisdiction: Jurisdiction;
  readonly flaggedAt: string;
  readonly evidenceSummary?: string;
}

export const SAFEGUARD_KINDS = [
  'extra-confirmation',
  'simplified-language',
  'advocacy-contact',
  'in-person-only',
  'translator',
  'cooling-off-extension',
  'no-automated-decision',
  'guardian-required',
  'larger-text',
  'audio-summary',
  'no-marketing',
  'mandatory-explanation',
] as const;
export type SafeguardKind = (typeof SAFEGUARD_KINDS)[number];

export interface Safeguard {
  readonly kind: SafeguardKind;
  readonly reason: string;
  readonly jurisdiction: Jurisdiction;
  readonly source: string;
}

// ─────────────────────────────────────────────────────────────────────
// Right to explanation (GDPR Art 22 + EU AI Act)
// ─────────────────────────────────────────────────────────────────────

/** A logged automated decision (input → output). */
export interface AutomatedDecisionDisclosure {
  readonly decisionId: string;
  readonly subjectId: string;
  readonly decision: string;
  readonly model: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly alternatives: ReadonlyArray<{
    readonly decision: string;
    readonly confidence: number;
  }>;
  readonly jurisdiction: Jurisdiction;
  readonly decidedAt: string;
  /** Has the subject opted out of automation for this scope? */
  readonly humanReviewed?: boolean;
}

/** A subject's request to receive an explanation of a decision. */
export interface RightToExplanationRequest {
  readonly subjectId: string;
  readonly decisionId: string;
  readonly jurisdiction: Jurisdiction;
  readonly requestedAt: string;
  /** Optional channel preference (where to deliver the explanation). */
  readonly deliveryChannel?: ConsentChannel;
}

/** Human-readable explanation + a counterfactual that would flip it. */
export interface Explanation {
  readonly decisionId: string;
  readonly summary: string;
  readonly topFactors: ReadonlyArray<{
    readonly factor: string;
    readonly weight: number;
  }>;
  readonly counterfactual: {
    readonly description: string;
    readonly changes: Readonly<Record<string, unknown>>;
    readonly wouldYield: string;
  };
  readonly humanContact: string;
  readonly generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Dark patterns (Brignull's taxonomy, 14 closed types)
// ─────────────────────────────────────────────────────────────────────

/**
 * The 14 Brignull/Mathur dark-pattern categories. Lower-case kebab to
 * stay stable across persistence systems.
 */
export const BRIGNULL_DARK_PATTERN_TYPES = [
  'sneaking',
  'urgency',
  'misdirection',
  'social-proof',
  'scarcity',
  'obstruction',
  'forced-action',
  'roach-motel',
  'privacy-zuckering',
  'price-comparison-prevention',
  'hidden-costs',
  'bait-and-switch',
  'confirmshaming',
  'disguised-ads',
] as const;
export type BrignullDarkPattern = (typeof BRIGNULL_DARK_PATTERN_TYPES)[number];

export interface DarkPatternDetection {
  readonly type: BrignullDarkPattern;
  readonly severity: EthicsSeverity;
  readonly evidence: string;
  readonly location: string;
  readonly recommendedFix: string;
  readonly source: string;
}

// ─────────────────────────────────────────────────────────────────────
// Surveillance consent (cameras/sensors in rented units)
// ─────────────────────────────────────────────────────────────────────

export const SURVEILLANCE_DEVICE_TYPES = [
  'doorbell-camera',
  'indoor-camera',
  'outdoor-camera',
  'audio-recorder',
  'motion-sensor',
  'smart-lock',
  'smart-thermostat',
  'occupancy-sensor',
  'noise-sensor',
  'leak-sensor',
] as const;
export type SurveillanceDeviceType = (typeof SURVEILLANCE_DEVICE_TYPES)[number];

export const RECORDING_POLICIES = [
  'always-on',
  'event-triggered',
  'on-demand',
  'never',
] as const;
export type RecordingPolicy = (typeof RECORDING_POLICIES)[number];

export interface SurveillanceDevice {
  readonly deviceId: string;
  readonly unitId: string;
  readonly type: SurveillanceDeviceType;
  readonly location: string;
  readonly recordingPolicy: RecordingPolicy;
  readonly registeredAt: string;
  readonly disclosureUrl?: string;
}

export interface SurveillanceConsent {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly unitId: string;
  readonly granted: boolean;
  readonly recordedAt: string;
  readonly jurisdiction: Jurisdiction;
}

export interface SurveillanceConsentStatus {
  readonly valid: boolean;
  readonly missingConsent: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Accessibility (WCAG 2.2 AA + Section 508)
// ─────────────────────────────────────────────────────────────────────

/**
 * The 16 WCAG 2.2 AA success criteria the framework auto-scans.
 * Each maps 1:1 to a check in `src/accessibility/checks.ts`.
 */
export const WCAG_SUCCESS_CRITERIA = [
  '1.1.1-non-text-content',
  '1.3.1-info-and-relationships',
  '1.3.5-identify-input-purpose',
  '1.4.3-contrast-minimum',
  '1.4.10-reflow',
  '1.4.11-non-text-contrast',
  '2.1.1-keyboard',
  '2.4.3-focus-order',
  '2.4.4-link-purpose',
  '2.4.6-headings-and-labels',
  '2.4.7-focus-visible',
  '2.5.7-dragging-movements',
  '2.5.8-target-size-minimum',
  '3.2.6-consistent-help',
  '3.3.7-redundant-entry',
  '4.1.2-name-role-value',
] as const;
export type WcagSuccessCriterion = (typeof WCAG_SUCCESS_CRITERIA)[number];

export interface AccessibilityCheck {
  readonly wcagSc: WcagSuccessCriterion;
  readonly passed: boolean;
  readonly evidence: string;
  readonly severity: EthicsSeverity;
  readonly remediation: string;
}

export interface AccessibilityScore {
  readonly url?: string;
  readonly checks: ReadonlyArray<AccessibilityCheck>;
  readonly passes: number;
  readonly failures: number;
  readonly score: number;
  readonly scannedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Store port (in-mem default; pluggable for DB persistence)
// ─────────────────────────────────────────────────────────────────────

/**
 * The single port the ethics framework requires for persistence.
 * Implementations can sit in front of Postgres / Redis / object store.
 * The shipped `createInMemoryStore()` is for tests and dev only.
 */
export interface EthicsStore {
  appendConsent(record: ConsentRecord): Promise<void>;
  consentHistory(args: {
    subjectId: string;
    scope: ConsentScope;
  }): Promise<ReadonlyArray<ConsentRecord>>;

  appendVulnerabilityFlag(flag: VulnerabilityFlag): Promise<void>;
  vulnerabilityFlags(subjectId: string): Promise<ReadonlyArray<VulnerabilityFlag>>;

  appendAutomatedDecision(decision: AutomatedDecisionDisclosure): Promise<void>;
  findDecision(decisionId: string): Promise<AutomatedDecisionDisclosure | null>;
  recordExplanationRequest(req: RightToExplanationRequest): Promise<void>;
  recordAutomationOptOut(args: {
    subjectId: string;
    scope: ConsentScope;
    recordedAt: string;
  }): Promise<void>;
  automationOptedOut(args: {
    subjectId: string;
    scope: ConsentScope;
  }): Promise<boolean>;

  registerSurveillanceDevice(device: SurveillanceDevice): Promise<void>;
  findSurveillanceDevice(deviceId: string): Promise<SurveillanceDevice | null>;
  surveillanceDevicesForUnit(unitId: string): Promise<ReadonlyArray<SurveillanceDevice>>;
  appendSurveillanceConsent(record: SurveillanceConsent): Promise<void>;
  latestSurveillanceConsent(args: {
    tenantId: string;
    deviceId: string;
  }): Promise<SurveillanceConsent | null>;
}
