/**
 * `maintenance.pick_vendor` — read tier.
 *
 * Filter vendors by capability_tags ⊇ required_skills and
 * service_area ∋ property_location. Score:
 *   score = wHistory*historical_quality
 *         + wSla*sla_compliance
 *         + wCost*(1 - cost_band_norm)
 *
 * Returns top-3 with a per-vendor rationale.
 */

import type { TicketCategory } from './classify-ticket.js';

export interface VendorRecord {
  readonly id: string;
  readonly name: string;
  readonly capabilityTags: ReadonlyArray<string>;
  readonly serviceAreas: ReadonlyArray<string>;
  /** 0..1 — historical quality from prior jobs. */
  readonly historicalQuality: number;
  /** 0..1 — fraction of jobs that met agreed SLA. */
  readonly slaCompliance: number;
  /** 1..5 — cost band (1=cheap, 5=premium). */
  readonly costBand: number;
  /** Optional emergency-on-call flag. */
  readonly emergencyAvailable?: boolean;
  /** Off-board status — never pick. */
  readonly offboarded?: boolean;
}

export interface PickVendorArgs {
  readonly vendors: ReadonlyArray<VendorRecord>;
  readonly requiredSkills: ReadonlyArray<string>;
  readonly propertyLocation: string;
  readonly urgency: 'emergency' | 'high' | 'medium' | 'low';
  readonly category: TicketCategory;
  readonly weights?: {
    readonly history?: number;
    readonly sla?: number;
    readonly cost?: number;
  };
}

export interface VendorPick {
  readonly vendorId: string;
  readonly vendorName: string;
  readonly score: number;
  readonly reasoning: string;
}

export interface PickVendorResult {
  readonly top: ReadonlyArray<VendorPick>;
  readonly considered: number;
  readonly filteredOut: ReadonlyArray<{ readonly vendorId: string; readonly reason: string }>;
}

const DEFAULT_WEIGHTS = Object.freeze({ history: 0.5, sla: 0.35, cost: 0.15 });

export function pickVendor(args: PickVendorArgs): PickVendorResult {
  const wh = args.weights?.history ?? DEFAULT_WEIGHTS.history;
  const ws = args.weights?.sla ?? DEFAULT_WEIGHTS.sla;
  const wc = args.weights?.cost ?? DEFAULT_WEIGHTS.cost;
  const filteredOut: { vendorId: string; reason: string }[] = [];
  const eligible: { vendor: VendorRecord; score: number; rationale: string }[] = [];

  for (const v of args.vendors) {
    if (v.offboarded === true) {
      filteredOut.push({ vendorId: v.id, reason: 'offboarded' });
      continue;
    }
    if (args.requiredSkills.length > 0) {
      const skillSet = new Set(v.capabilityTags);
      const missing = args.requiredSkills.filter(s => !skillSet.has(s));
      if (missing.length === args.requiredSkills.length) {
        filteredOut.push({ vendorId: v.id, reason: `missing-skills:${missing.join(',')}` });
        continue;
      }
    }
    if (!v.serviceAreas.includes(args.propertyLocation)) {
      filteredOut.push({ vendorId: v.id, reason: `out-of-service-area:${args.propertyLocation}` });
      continue;
    }
    if (args.urgency === 'emergency' && v.emergencyAvailable !== true) {
      filteredOut.push({ vendorId: v.id, reason: 'no-emergency-coverage' });
      continue;
    }

    const costNorm = Math.max(0, Math.min(1, (v.costBand - 1) / 4));
    const score = wh * v.historicalQuality + ws * v.slaCompliance + wc * (1 - costNorm);
    const rationale = `quality=${v.historicalQuality.toFixed(2)} sla=${v.slaCompliance.toFixed(2)} cost=${v.costBand}`;
    eligible.push({ vendor: v, score, rationale });
  }

  eligible.sort((a, b) => b.score - a.score);
  const top = eligible.slice(0, 3).map(e => ({
    vendorId: e.vendor.id,
    vendorName: e.vendor.name,
    score: Number(e.score.toFixed(4)),
    reasoning: e.rationale,
  }));

  return Object.freeze({
    top: Object.freeze(top),
    considered: args.vendors.length,
    filteredOut: Object.freeze(filteredOut),
  });
}
