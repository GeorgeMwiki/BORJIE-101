/**
 * Surveillance-device disclosure rules per jurisdiction.
 *
 * Citations:
 *  - NIST IR 8062 — "An Introduction to Privacy Engineering and Risk
 *    Management in Federal Systems" — predictable, manageable,
 *    disassociable.
 *  - Future of Privacy Forum (FPF) "Camera-in-the-Home" guidelines
 *    (2020) — disclosure + opt-in + zones-of-privacy + audio rules.
 *  - TZ Personal Data Protection Act 2022 § 25 (notice obligation)
 *  - KE Data Protection Act 2019 § 28 (CCTV notice + DPIA)
 *  - UG Data Protection and Privacy Act 2019 § 8 + Reg. 22
 *  - RW Law 058/2021 Arts. 27-28 (transparency)
 *  - NG NDPA 2023 § 24
 *  - ZA POPIA Sec. 18 (notification to data subject)
 *  - GDPR Recital 49 + Art. 6(1)(c)+(f) (legitimate interest CCTV)
 *  - UK ICO CCTV Code of Practice (Jan 2023)
 *  - US — state-by-state two-party consent laws for audio
 *    (CA, FL, IL, MA, MD, MT, NH, PA, WA + 4 more = 12 states)
 *  - EU Council Directive 95/46 + UK Tenant Fees Act 2019 (no
 *    surveillance fee passable to tenant)
 *
 * For audio specifically we require AUDIO opt-in regardless of
 * jurisdiction — best practice exceeding any single statute.
 */

import type {
  Jurisdiction,
  RecordingPolicy,
  SurveillanceDeviceType,
} from '../types.js';

export interface DisclosureRule {
  readonly jurisdiction: Jurisdiction;
  readonly deviceType: SurveillanceDeviceType;
  readonly mustDiscloseAtLeaseSign: boolean;
  readonly requiresTenantOptIn: boolean;
  readonly requiresVisibleSignage: boolean;
  readonly bannedRecordingPolicies: ReadonlyArray<RecordingPolicy>;
  readonly source: string;
}

function deviceRule(
  jurisdiction: Jurisdiction,
  deviceType: SurveillanceDeviceType,
  partial: Omit<DisclosureRule, 'jurisdiction' | 'deviceType' | 'bannedRecordingPolicies' | 'source'> & {
    bannedRecordingPolicies?: ReadonlyArray<RecordingPolicy>;
    source: string;
  },
): DisclosureRule {
  return {
    jurisdiction,
    deviceType,
    mustDiscloseAtLeaseSign: partial.mustDiscloseAtLeaseSign,
    requiresTenantOptIn: partial.requiresTenantOptIn,
    requiresVisibleSignage: partial.requiresVisibleSignage,
    bannedRecordingPolicies: partial.bannedRecordingPolicies ?? [],
    source: partial.source,
  };
}

const INDOOR_TYPES: ReadonlyArray<SurveillanceDeviceType> = [
  'indoor-camera',
  'audio-recorder',
  'occupancy-sensor',
];

const OUTDOOR_TYPES: ReadonlyArray<SurveillanceDeviceType> = [
  'doorbell-camera',
  'outdoor-camera',
];

const ALL_TYPES: ReadonlyArray<SurveillanceDeviceType> = [
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
];

// ── Indoor cameras are flat-out banned in 'always-on' for ALL juris ──
const BAN_INDOOR_ALWAYS_ON: ReadonlyArray<RecordingPolicy> = ['always-on'];

export const SURVEILLANCE_DISCLOSURE_RULES: ReadonlyArray<DisclosureRule> = Object.freeze(
  [
    // ── TZ ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('TZ', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'TZ PDPA 2022 § 25',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── KE ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('KE', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'KE DPA 2019 § 28 (CCTV + DPIA)',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── UG ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('UG', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'UG DPP Act 2019 § 8 + Reg. 22',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── RW ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('RW', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'RW Law 058/2021 Art. 27-28',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── NG ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('NG', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'NG NDPA 2023 § 24',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── ZA ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('ZA', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'ZA POPIA Sec. 18',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── EU ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('EU', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'GDPR Art. 6(1)(c)+(f) + Recital 49 + EDPB CCTV Guidelines 3/2019',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── UK ─────────────────────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('UK', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t),
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source: 'UK ICO CCTV Code of Practice (Jan 2023)',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── US (federal floor) ────────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('US', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t) || t === 'audio-recorder',
        requiresVisibleSignage: OUTDOOR_TYPES.includes(t),
        source:
          t === 'audio-recorder'
            ? '18 USC § 2511 + 12 US states two-party consent (CA, FL, IL, MA, MD, MT, NH, PA, WA, etc.)'
            : 'FPF Camera-in-the-Home Guidelines (2020) + state common law',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
    // ── US-CA (CCPA + CalECPA) ────────────────────────────────────────
    ...ALL_TYPES.map((t) =>
      deviceRule('US-CA', t, {
        mustDiscloseAtLeaseSign: true,
        requiresTenantOptIn: INDOOR_TYPES.includes(t) || t === 'audio-recorder',
        requiresVisibleSignage: true,
        source: 'CCPA + CalECPA + Cal. Penal Code § 632 (two-party audio)',
        bannedRecordingPolicies: INDOOR_TYPES.includes(t) ? BAN_INDOOR_ALWAYS_ON : [],
      }),
    ),
  ],
);

/** Look up the rule for a given (jurisdiction, deviceType). */
export function disclosureRuleFor(
  jurisdiction: Jurisdiction,
  deviceType: SurveillanceDeviceType,
): DisclosureRule | undefined {
  return SURVEILLANCE_DISCLOSURE_RULES.find(
    (r) => r.jurisdiction === jurisdiction && r.deviceType === deviceType,
  );
}
