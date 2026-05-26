/**
 * Stage 1 — Intent + Entity Recognition.
 *
 * Deterministic-first column-name pattern matching against the closed
 * entity-type catalogue in DATA_ONBOARDING_SPEC.md §5. Each candidate
 * receives a confidence score in [0, 1]. The caller compares against
 * the `ENTITY_CONFIDENCE_FLOOR` and asks a clarifying question on tie
 * or sub-floor matches.
 *
 * Pure function — no I/O, no LLM call. Future waves can layer an LLM
 * re-classifier behind a feature flag without altering this surface.
 */

import type { EntityType, TabularSample } from '../types.js';
import { ENTITY_CONFIDENCE_FLOOR } from '../types.js';

interface EntitySignature {
  readonly entity_type: EntityType;
  /** Column name (or alias) signals. Match against snake-cased headers. */
  readonly required_any: ReadonlyArray<ReadonlyArray<string>>;
  /** Optional supporting columns — boost confidence when present. */
  readonly supporting: ReadonlyArray<string>;
  readonly target_table: string;
}

const SIGNATURES: ReadonlyArray<EntitySignature> = Object.freeze([
  {
    entity_type: 'worker',
    required_any: [['nida', 'national_id'], ['name', 'full_name', 'employee_name']],
    supporting: ['role', 'designation', 'site', 'shift', 'department'],
    target_table: 'workers',
  },
  {
    entity_type: 'parcel',
    required_any: [['parcel_id', 'parcel_no', 'lot_id'], ['grade', 'weight', 'tonnage']],
    supporting: ['location', 'site', 'origin', 'mineral'],
    target_table: 'ore_parcels',
  },
  {
    entity_type: 'licence',
    required_any: [['licence_no', 'license_no', 'permit_no'], ['expiry', 'expires_at', 'valid_until']],
    supporting: ['issued_at', 'authority', 'tumemadini', 'jurisdiction'],
    target_table: 'mining_licences',
  },
  {
    entity_type: 'site',
    required_any: [['site_name', 'site_id'], ['coords', 'latitude', 'lat', 'gps']],
    supporting: ['region', 'district', 'area_ha'],
    target_table: 'sites',
  },
  {
    entity_type: 'buyer',
    required_any: [['buyer_name', 'buyer_id'], ['kyb_status', 'kyb', 'kyc_status']],
    supporting: ['country', 'tin', 'pep_status'],
    target_table: 'buyers',
  },
  {
    entity_type: 'incident',
    required_any: [['incident_date', 'occurred_at'], ['severity', 'category']],
    supporting: ['worker_id', 'site_id', 'description'],
    target_table: 'incidents',
  },
  {
    entity_type: 'certification',
    required_any: [['cert_id', 'certificate_no'], ['issued_at', 'issue_date']],
    supporting: ['worker_id', 'expires_at', 'authority'],
    target_table: 'certifications',
  },
  {
    entity_type: 'shift',
    required_any: [['shift_date', 'shift_start'], ['worker_id', 'employee_id']],
    supporting: ['site_id', 'crew_id', 'hours'],
    target_table: 'shift_assignments',
  },
  {
    entity_type: 'payroll_entry',
    required_any: [['amount_minor', 'amount', 'gross_pay'], ['period', 'pay_period']],
    supporting: ['worker_id', 'currency', 'net_pay', 'deductions'],
    target_table: 'payroll_entries',
  },
  {
    entity_type: 'drill_hole',
    required_any: [['drill_hole_id', 'hole_id'], ['depth', 'depth_m']],
    supporting: ['site_id', 'azimuth', 'dip', 'collar_x'],
    target_table: 'drill_holes',
  },
  {
    entity_type: 'assay',
    required_any: [['sample_id', 'assay_id'], ['grade', 'au_gpt', 'cu_pct']],
    supporting: ['drill_hole_id', 'lab', 'reported_at'],
    target_table: 'assays',
  },
  {
    entity_type: 'asset',
    required_any: [['asset_tag', 'asset_id'], ['asset_type', 'category']],
    supporting: ['serial', 'site_id', 'commissioned_at'],
    target_table: 'assets_fleet',
  },
  {
    entity_type: 'inspection',
    required_any: [['inspection_date', 'inspected_at'], ['score', 'rating', 'result']],
    supporting: ['site_id', 'inspector', 'category'],
    target_table: 'safety_inspections',
  },
]);

const HINT_BOOSTS: Readonly<Record<string, EntityType>> = Object.freeze({
  employee: 'worker',
  employees: 'worker',
  staff: 'worker',
  workforce: 'worker',
  workers: 'worker',
  parcel: 'parcel',
  parcels: 'parcel',
  ore: 'parcel',
  licence: 'licence',
  licences: 'licence',
  license: 'licence',
  buyer: 'buyer',
  buyers: 'buyer',
  customer: 'buyer',
  incident: 'incident',
  incidents: 'incident',
  certification: 'certification',
  certifications: 'certification',
  shift: 'shift',
  shifts: 'shift',
  payroll: 'payroll_entry',
  salary: 'payroll_entry',
  drill: 'drill_hole',
  assay: 'assay',
  inspection: 'inspection',
});

function snakeCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

interface RecognizerResult {
  readonly inferred_entity_type: EntityType;
  readonly entity_confidence: number;
  readonly target_table: string;
  readonly above_floor: boolean;
}

/**
 * Recognise the entity type of a tabular feed by matching its column
 * headers (plus an optional caller-supplied hint) against the closed
 * catalogue. Returns the best candidate plus a confidence in [0, 1].
 *
 * The caller is expected to compare `entity_confidence` against
 * `ENTITY_CONFIDENCE_FLOOR` (0.7) and ask a clarifying question
 * rather than guess when the result is below floor.
 */
export function recognizeEntityType(
  sample: TabularSample,
  intent_hint?: string,
): RecognizerResult {
  const normalized_headers = sample.headers.map(snakeCase);
  const hint_token = intent_hint
    ? snakeCase(intent_hint).split('_').find((t) => HINT_BOOSTS[t])
    : undefined;
  const hint_type =
    hint_token !== undefined ? HINT_BOOSTS[hint_token] : undefined;

  let best: RecognizerResult = {
    inferred_entity_type: 'unknown',
    entity_confidence: 0,
    target_table: '',
    above_floor: false,
  };

  for (const sig of SIGNATURES) {
    const required_score = sig.required_any.reduce((acc, group) => {
      const hit = group.some((alias) => normalized_headers.includes(alias));
      return hit ? acc + 1 : acc;
    }, 0);

    if (required_score === 0) continue;

    const required_completeness = required_score / sig.required_any.length;

    const supporting_hits = sig.supporting.filter((s) =>
      normalized_headers.includes(s),
    ).length;
    const supporting_boost =
      sig.supporting.length === 0
        ? 0
        : (supporting_hits / sig.supporting.length) * 0.25;

    const hint_boost = hint_type === sig.entity_type ? 0.15 : 0;

    const raw = required_completeness * 0.7 + supporting_boost + hint_boost;
    const confidence = Math.min(1, Number(raw.toFixed(2)));

    if (confidence > best.entity_confidence) {
      best = {
        inferred_entity_type: sig.entity_type,
        entity_confidence: confidence,
        target_table: sig.target_table,
        above_floor: confidence >= ENTITY_CONFIDENCE_FLOOR,
      };
    }
  }

  return best;
}

export const __TEST_ONLY = Object.freeze({
  snakeCase,
  signatures: SIGNATURES,
});
