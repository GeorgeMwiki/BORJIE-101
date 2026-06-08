/**
 * Safety / EHS Agent — critical controls, incident heatmap, PPE
 * issuance tracking (AGENT_PROMPT_LIBRARY §18) DEEPENED with a
 * deterministic HSE-rate engine grounded in
 * `Docs/research/mining-esg-compliance.md` §1.1 (ICMM Principle 5 —
 * "elimination of fatalities, injuries and occupational disease") and
 * the GISTM "zero tolerance for human fatality" posture (§1.3).
 *
 * Two layers:
 *   1. DETERMINISTIC `computeSafetyRates()` — TRIFR / LTIFR / AIFR /
 *      fatality-rate per million hours worked, severity rate, and ICMM
 *      Critical-Control Management (CCM) verification status. Pure, no
 *      LLM, no network — every number traces to an incident_id + the
 *      hours-worked denominator (HSE is a HARD CONSTRAINT, not a KPI,
 *      per CAPABILITY_SPEC_WAVE3 "Licence-to-Operate" pillar).
 *   2. LLM narrative (optional) — `runClaudeJunior` for the qualitative
 *      heatmap commentary / required-actions wording only. The rates
 *      themselves are ALWAYS the deterministic truth.
 *
 * HIGH-risk guardrail mapping (advisory flags only — this junior NEVER
 * edits the kernel): any fatality or any failed/missing critical
 * control raises `escalation` keyed to the inviolable/policy-gate
 * prefixes the kernel owns (`kill_switch`, `four_eye`). The Master
 * Brain / policy-gate consume these flags; the junior only recommends.
 *
 * Writes via typed `db.insert(safetySnapshots)` (migration 0011).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas — incident + PPE inputs (kept stable for index.ts re-exports)
// ─────────────────────────────────────────────────────────────────────

export const IncidentKind = z.enum([
  'near_miss',
  'first_aid',
  'medical_treatment',
  'lost_time_injury',
  'restricted_work',
  'fatality',
  'environmental_release',
  'property_damage',
]);
export type IncidentKind = z.infer<typeof IncidentKind>;

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof Severity>;

export const IncidentRecord = z.object({
  incident_id: z.string().min(1),
  iso_ts: z.string(),
  kind: IncidentKind,
  severity: Severity,
  site_id: z.string(),
  description: z.string(),
  photo_evidence_ids: z.array(z.string()).default([]),
  /** Lost calendar days attributable to the incident (drives severity rate). */
  lost_days: z.number().int().nonnegative().default(0),
  /** Site section / zone, for the heatmap. */
  site_section: z.string().optional(),
});
export type IncidentRecord = z.infer<typeof IncidentRecord>;

export const PpeIssue = z.object({
  employee_id: z.string(),
  item: z.string(),
  issued_at: z.string(),
});
export type PpeIssue = z.infer<typeof PpeIssue>;

/**
 * ICMM Critical-Control Management (CCM) register row. Each critical
 * control is the LAST line of defence against a material unwanted event
 * (MUE) — fall-of-ground, vehicle interaction, inrush, etc. A control is
 * only "verified" if it was field-checked within its verification cadence.
 */
export const CriticalControlInput = z.object({
  control_id: z.string().min(1),
  /** The material unwanted event this control defends against. */
  mue: z.string().min(1),
  /** What the control IS (e.g. "ground support installed to standard"). */
  control: z.string().min(1),
  /** Named accountable person (ICMM "assign accountability"). */
  owner: z.string().min(1),
  /** ISO date of the last field verification, or null if never verified. */
  last_verified_iso: z.string().nullable().default(null),
  /** Required verification cadence in days (e.g. 7 for weekly). */
  cadence_days: z.number().int().positive().default(30),
  /** Most recent field-verification result. */
  field_result: z.enum(['pass', 'partial', 'fail', 'unverified']).default('unverified'),
  /** Evidence the verification happened (photo / checklist id). */
  verification_evidence_id: z.string().optional(),
});
export type CriticalControlInput = z.infer<typeof CriticalControlInput>;

export const SafetyAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  recent_incidents: z.array(IncidentRecord).default([]),
  ppe_issuance: z.array(PpeIssue).default([]),
  /** Headcount that should hold PPE (denominator for compliance %). */
  workforce_headcount: z.number().int().nonnegative().default(0),
  /**
   * Total hours worked across the reporting window — the standard
   * denominator for TRIFR/LTIFR (ICMM uses per 1,000,000 hours worked).
   * Ties to the workforce-hours TRIFR-denominator rule in the spec.
   */
  hours_worked: z.number().nonnegative().default(0),
  critical_controls: z.array(CriticalControlInput).default([]),
  /** ISO date the report is generated against (for cadence math). */
  as_of_iso: z.string().optional(),
  has_explosives_magazine: z.boolean().default(false),
  has_cyanide: z.boolean().default(false),
  has_mercury: z.boolean().default(false),
  norm_material_present: z.boolean().default(false),
});
export type SafetyAgentInput = z.infer<typeof SafetyAgentInputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Output schema
// ─────────────────────────────────────────────────────────────────────

export const SafetyRates = z.object({
  hours_worked: z.number().nonnegative(),
  /** Per million hours worked: recordable (MTI+RWC+LTI+fatality). */
  trifr: z.number().nonnegative(),
  /** Per million hours worked: lost-time injuries (LTI+fatality). */
  ltifr: z.number().nonnegative(),
  /** Per million hours worked: ALL injuries incl. first-aid. */
  aifr: z.number().nonnegative(),
  /** Per million hours worked: fatalities. */
  fatality_rate: z.number().nonnegative(),
  /** Lost days per million hours worked. */
  severity_rate: z.number().nonnegative(),
  recordable_count: z.number().int().nonnegative(),
  lost_time_count: z.number().int().nonnegative(),
  fatality_count: z.number().int().nonnegative(),
  /** True when hours_worked is 0 — rates are reported as 0 but UNRELIABLE. */
  denominator_insufficient: z.boolean(),
});
export type SafetyRates = z.infer<typeof SafetyRates>;

export const CriticalControlStatus = z.object({
  control_id: z.string(),
  mue: z.string(),
  owner: z.string(),
  status: z.enum(['effective', 'degraded', 'failed', 'unknown']),
  /** Verified within cadence AND last field result was a pass. */
  verified: z.boolean(),
  /** Days since last verification (null when never verified). */
  days_since_verification: z.number().int().nullable(),
  /** True when verification is older than the required cadence. */
  overdue: z.boolean(),
  reason: z.string(),
});
export type CriticalControlStatus = z.infer<typeof CriticalControlStatus>;

export const SafetyEscalation = z.object({
  /** Maps to a kernel inviolable/policy-gate prefix (advisory only). */
  policy_prefix: z.enum(['kill_switch', 'four_eye', 'sovereign', 'none']),
  reason: z.string(),
  evidence_id: z.string(),
});
export type SafetyEscalation = z.infer<typeof SafetyEscalation>;

export const SafetyAgentOutput = AuditedOutputBase.extend({
  site_id: z.string(),
  rates: SafetyRates,
  critical_controls: z.array(CriticalControlStatus),
  /** Count of critical controls that are failed or unverified-overdue. */
  controls_at_risk: z.number().int().nonnegative(),
  incident_heatmap: z.array(
    z.object({
      site_section: z.string(),
      severity_score: z.number().nonnegative(),
      count: z.number().int().nonnegative(),
    }),
  ),
  ppe_compliance_pct: z.number().min(0).max(100),
  immediate_alerts: z.array(z.string()),
  required_actions: z.array(z.string()),
  /** HIGH-risk guardrail flags for the kernel to consume (never auto-acted here). */
  escalations: z.array(SafetyEscalation).default([]),
});
export type SafetyAgentOutput = z.infer<typeof SafetyAgentOutput>;

// ─────────────────────────────────────────────────────────────────────
// Deterministic HSE-rate engine (pure — no LLM, no network)
// ─────────────────────────────────────────────────────────────────────

const PER_MILLION = 1_000_000;
const SEVERITY_WEIGHT: Record<Severity, number> = { low: 1, medium: 3, high: 8, critical: 20 };

/** Recordable kinds per OSHA/ICMM (excludes first-aid + near-miss + non-injury). */
const RECORDABLE_KINDS: ReadonlySet<IncidentKind> = new Set<IncidentKind>([
  'medical_treatment',
  'lost_time_injury',
  'restricted_work',
  'fatality',
]);
/** Lost-time kinds (the LTIFR numerator). */
const LOST_TIME_KINDS: ReadonlySet<IncidentKind> = new Set<IncidentKind>([
  'lost_time_injury',
  'fatality',
]);
/** Injury kinds (the AIFR numerator — every harm-to-person event). */
const INJURY_KINDS: ReadonlySet<IncidentKind> = new Set<IncidentKind>([
  'first_aid',
  'medical_treatment',
  'lost_time_injury',
  'restricted_work',
  'fatality',
]);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Compute ICMM-aligned safety frequency rates. Rate = numerator /
 * hours_worked * 1,000,000. When hours_worked is 0 the rates are
 * reported as 0 but flagged `denominator_insufficient` — a world-class
 * MD never confabulates a TRIFR from a missing denominator.
 */
export function computeSafetyRates(
  incidents: ReadonlyArray<IncidentRecord>,
  hoursWorked: number,
): SafetyRates {
  const recordable = incidents.filter((i) => RECORDABLE_KINDS.has(i.kind));
  const lostTime = incidents.filter((i) => LOST_TIME_KINDS.has(i.kind));
  const injuries = incidents.filter((i) => INJURY_KINDS.has(i.kind));
  const fatalities = incidents.filter((i) => i.kind === 'fatality');
  const lostDays = incidents.reduce((sum, i) => sum + i.lost_days, 0);

  const denominatorInsufficient = hoursWorked <= 0;
  const factor = denominatorInsufficient ? 0 : PER_MILLION / hoursWorked;

  return {
    hours_worked: hoursWorked,
    trifr: round2(recordable.length * factor),
    ltifr: round2(lostTime.length * factor),
    aifr: round2(injuries.length * factor),
    fatality_rate: round2(fatalities.length * factor),
    severity_rate: round2(lostDays * factor),
    recordable_count: recordable.length,
    lost_time_count: lostTime.length,
    fatality_count: fatalities.length,
    denominator_insufficient: denominatorInsufficient,
  };
}

/**
 * Deterministic ICMM Critical-Control Management verification. A control
 * is `effective` only when its last field result is a `pass` AND the
 * verification is within cadence. `fail` -> failed; `partial` -> degraded;
 * overdue/unverified -> unknown.
 */
export function verifyCriticalControls(
  controls: ReadonlyArray<CriticalControlInput>,
  asOfIso: string,
): ReadonlyArray<CriticalControlStatus> {
  const asOf = Date.parse(asOfIso);
  const asOfValid = Number.isFinite(asOf);
  return controls.map((c) => {
    const lastMs = c.last_verified_iso ? Date.parse(c.last_verified_iso) : NaN;
    const hasVerification = Number.isFinite(lastMs);
    const daysSince =
      hasVerification && asOfValid
        ? Math.max(0, Math.floor((asOf - lastMs) / 86_400_000))
        : null;
    const overdue = daysSince === null ? true : daysSince > c.cadence_days;

    let status: CriticalControlStatus['status'];
    let reason: string;
    if (c.field_result === 'fail') {
      status = 'failed';
      reason = `Last field verification FAILED for MUE "${c.mue}".`;
    } else if (c.field_result === 'partial') {
      status = 'degraded';
      reason = `Field verification only PARTIAL for MUE "${c.mue}".`;
    } else if (c.field_result === 'unverified' || !hasVerification) {
      status = 'unknown';
      reason = `No valid field verification on record for MUE "${c.mue}".`;
    } else if (overdue) {
      status = 'unknown';
      reason = `Verification overdue (${daysSince}d > ${c.cadence_days}d cadence) for MUE "${c.mue}".`;
    } else {
      status = 'effective';
      reason = `Verified pass within cadence (${daysSince}d <= ${c.cadence_days}d).`;
    }

    return {
      control_id: c.control_id,
      mue: c.mue,
      owner: c.owner,
      status,
      verified: status === 'effective',
      days_since_verification: daysSince,
      overdue,
      reason,
    };
  });
}

/** Deterministic severity-weighted heatmap keyed by site_section. */
export function buildIncidentHeatmap(
  incidents: ReadonlyArray<IncidentRecord>,
): ReadonlyArray<{ site_section: string; severity_score: number; count: number }> {
  const bySection = new Map<string, { score: number; count: number }>();
  for (const i of incidents) {
    const section = i.site_section ?? 'unspecified';
    const prev = bySection.get(section) ?? { score: 0, count: 0 };
    bySection.set(section, {
      score: prev.score + SEVERITY_WEIGHT[i.severity],
      count: prev.count + 1,
    });
  }
  return [...bySection.entries()]
    .map(([site_section, v]) => ({ site_section, severity_score: v.score, count: v.count }))
    .sort((a, b) => b.severity_score - a.severity_score);
}

/** PPE compliance = distinct employees issued PPE / headcount (capped 100). */
export function computePpeCompliancePct(
  ppe: ReadonlyArray<PpeIssue>,
  headcount: number,
): number {
  if (headcount <= 0) return 0;
  const covered = new Set(ppe.map((p) => p.employee_id)).size;
  return round2(Math.min(100, (covered / headcount) * 100));
}

// ─────────────────────────────────────────────────────────────────────
// Prompt (narrative only — rates/controls are deterministic)
// ─────────────────────────────────────────────────────────────────────

export const SAFETY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Safety / EHS Agent',
  mandate:
    'HSE is a HARD CONSTRAINT, not a KPI (ICMM Principle 5: elimination of fatalities/injuries; GISTM zero-fatality posture). ' +
    'Frequency rates (TRIFR/LTIFR/AIFR/fatality-rate per 1,000,000 hours worked), critical-control verification and the ' +
    'incident heatmap are computed DETERMINISTICALLY and given to you. Your job is narrative + required-actions wording only — ' +
    'never restate or override a number; explain the at-risk critical controls and surface immediate alerts for any injury/fatality.',
  tools:
    'critical_controls, verify_critical_control, capture_toolbox_talk, log_incident, ppe_status, proximity_check, blast_permit_status, norm_status.',
  evidence:
    'Cite the incident_id for every alert. Cite the control_id + verification_evidence_id for every at-risk critical control. ' +
    'Cite the ICMM Principle / GISTM clause for the HSE-as-hard-constraint framing.',
  outputSchema:
    '{ "site_id": string, "rates": {...}, "critical_controls": [...], "controls_at_risk": number, "incident_heatmap": [...], ' +
    '"ppe_compliance_pct": number, "immediate_alerts": string[], "required_actions": string[], "escalations": [...], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'monitoring + alerting; never issues PPE or signs off blast permits autonomously',
  hardRules: [
    'IMMEDIATELY alert the owner on any worker injury or fatality; do not buffer.',
    'Never restate a frequency rate differently from the deterministic value supplied.',
    'Refuse to advise blasting operations; only track lawful permits.',
    'Refuse mercury operational advice that increases exposure (Minamata-compliant abatement only).',
    'Refuse cyanidation advice without ICMC alignment + secondary containment.',
    'Refuse work within 60 m of a water source (NAWAPO 2002).',
  ],
});

function buildUserPrompt(
  input: SafetyAgentInput,
  rates: SafetyRates,
  controls: ReadonlyArray<CriticalControlStatus>,
): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}`,
    `FLAGS: explosives=${input.has_explosives_magazine} cyanide=${input.has_cyanide} mercury=${input.has_mercury} norm=${input.norm_material_present}`,
    `DETERMINISTIC_RATES (authoritative — do not change):`,
    JSON.stringify(rates, null, 2),
    `DETERMINISTIC_CRITICAL_CONTROLS (authoritative):`,
    JSON.stringify(controls, null, 2).slice(0, 3_000),
    `RECENT_INCIDENTS (${input.recent_incidents.length}):`,
    JSON.stringify(input.recent_incidents, null, 2).slice(0, 3_000),
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic alert + escalation assembly
// ─────────────────────────────────────────────────────────────────────

function assembleAlertsAndEscalations(
  input: SafetyAgentInput,
  rates: SafetyRates,
  controls: ReadonlyArray<CriticalControlStatus>,
): { alerts: string[]; escalations: SafetyEscalation[]; controlsAtRisk: number } {
  const alerts: string[] = [];
  const escalations: SafetyEscalation[] = [];

  // Any fatality → kill-switch class (catastrophic-irreversible / GISTM zero-fatality).
  const fatalities = input.recent_incidents.filter((i) => i.kind === 'fatality');
  for (const f of fatalities) {
    alerts.push(`FATALITY at ${f.site_section ?? f.site_id}: ${f.description} (${f.incident_id}).`);
    escalations.push({
      policy_prefix: 'kill_switch',
      reason: `Fatality recorded (${f.incident_id}) — ICMM Principle 5 / GISTM zero-tolerance; stop-work & owner sign-off required.`,
      evidence_id: f.incident_id,
    });
  }

  // Any failed critical control → four-eye class (last line of defence breached).
  const failed = controls.filter((c) => c.status === 'failed');
  for (const c of failed) {
    alerts.push(`FAILED critical control ${c.control_id} for MUE "${c.mue}" (owner ${c.owner}).`);
    escalations.push({
      policy_prefix: 'four_eye',
      reason: `Critical control ${c.control_id} FAILED — material unwanted event "${c.mue}" undefended; two-person verification required to resume.`,
      evidence_id: c.control_id,
    });
  }

  // High-severity injuries (non-fatal) → immediate alert, no kill-switch.
  for (const i of input.recent_incidents) {
    if (i.kind !== 'fatality' && (i.severity === 'critical' || i.severity === 'high')) {
      alerts.push(`${i.severity.toUpperCase()} ${i.kind} (${i.incident_id}): ${i.description}.`);
    }
  }

  const atRiskControls = controls.filter((c) => c.status === 'failed' || c.status === 'unknown');
  const controlsAtRisk = atRiskControls.length;

  if (rates.denominator_insufficient && input.recent_incidents.length > 0) {
    alerts.push('Hours-worked denominator missing — TRIFR/LTIFR UNRELIABLE; supply hours_worked.');
  }

  return { alerts, escalations, controlsAtRisk };
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSafetyAgent(deps: JuniorDeps) {
  return {
    async processInput(input: SafetyAgentInput): Promise<SafetyAgentOutput> {
      const validated = SafetyAgentInputSchema.parse(input);
      const asOf = validated.as_of_iso ?? new Date().toISOString();

      // 1) Deterministic truth — these are NEVER produced by the LLM.
      const rates = computeSafetyRates(validated.recent_incidents, validated.hours_worked);
      const controls = verifyCriticalControls(validated.critical_controls, asOf);
      const heatmap = buildIncidentHeatmap(validated.recent_incidents);
      const ppeCompliance = computePpeCompliancePct(
        validated.ppe_issuance,
        validated.workforce_headcount,
      );
      const { alerts, escalations, controlsAtRisk } = assembleAlertsAndEscalations(
        validated,
        rates,
        controls,
      );

      // Deterministic evidence chain — incident_ids + control_ids actually used.
      const evidenceIds = [
        ...validated.recent_incidents.map((i) => i.incident_id),
        ...controls.map((c) => c.control_id),
      ];
      const baseEvidence = evidenceIds.length > 0 ? evidenceIds : ['safety_baseline_no_incidents'];

      // 2) LLM narrative (best-effort). On any failure we fall back to a
      //    deterministic envelope so the HARD-CONSTRAINT rates always ship.
      let narrative: { required_actions: string[]; rationale: string; citations: string[] } = {
        required_actions: deterministicRequiredActions(controls, rates),
        rationale: deterministicRationale(rates, controlsAtRisk),
        citations: [
          'mining-esg-compliance.md §1.1 ICMM Principle 5 (eliminate fatalities/injuries)',
          'mining-esg-compliance.md §1.3 GISTM zero-tolerance for human fatality',
        ],
      };
      try {
        const llm = await runClaudeJunior({
          claude: deps.claude,
          logger: deps.logger,
          juniorName: 'safety-agent',
          schema: SafetyAgentOutput,
          systemPrompt: SAFETY_SYSTEM_PROMPT,
          userPrompt: buildUserPrompt(validated, rates, controls),
          maxTokens: 2500,
        });
        narrative = {
          required_actions: llm.required_actions,
          rationale: llm.rationale,
          citations: llm.citations,
        };
      } catch (err) {
        deps.logger?.warn('safety-agent: LLM narrative skipped — using deterministic envelope', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const output: SafetyAgentOutput = {
        site_id: validated.siteId,
        rates,
        critical_controls: [...controls],
        controls_at_risk: controlsAtRisk,
        incident_heatmap: [...heatmap],
        ppe_compliance_pct: ppeCompliance,
        immediate_alerts: alerts,
        required_actions: narrative.required_actions,
        escalations,
        confidence: rates.denominator_insufficient ? 0.6 : 0.9,
        rationale: narrative.rationale,
        evidence_ids: baseEvidence,
        citations: narrative.citations,
      };

      await persistSnapshot(deps, validated, output);
      return output;
    },
  };
}
export type SafetyAgent = ReturnType<typeof createSafetyAgent>;

function deterministicRequiredActions(
  controls: ReadonlyArray<CriticalControlStatus>,
  rates: SafetyRates,
): string[] {
  const actions: string[] = [];
  for (const c of controls) {
    if (c.status === 'failed') {
      actions.push(`Stop work on MUE "${c.mue}"; restore critical control ${c.control_id} (owner ${c.owner}).`);
    } else if (c.status === 'unknown' && c.overdue) {
      actions.push(`Field-verify overdue critical control ${c.control_id} for MUE "${c.mue}".`);
    } else if (c.status === 'degraded') {
      actions.push(`Remediate partial critical control ${c.control_id} for MUE "${c.mue}".`);
    }
  }
  if (rates.fatality_count > 0) {
    actions.push('Invoke fatality protocol: stop-work, owner notification, regulator (OSHA) report.');
  }
  return actions;
}

function deterministicRationale(rates: SafetyRates, controlsAtRisk: number): string {
  return (
    `TRIFR ${rates.trifr}, LTIFR ${rates.ltifr}, fatality-rate ${rates.fatality_rate} per million hours` +
    `${rates.denominator_insufficient ? ' (denominator missing — rates unreliable)' : ''}; ` +
    `${controlsAtRisk} critical control(s) at risk. HSE treated as a hard constraint per ICMM Principle 5.`
  );
}

async function persistSnapshot(
  deps: JuniorDeps,
  validated: SafetyAgentInput,
  output: SafetyAgentOutput,
): Promise<void> {
  if (!deps.db) return;
  try {
    const schemas = await loadJuniorSchemas();
    const safetySnapshots = schemas?.safetySnapshots as unknown;
    if (safetySnapshots) {
      await deps.db
        .insert(safetySnapshots)
        .values({
          id: randomUUID(),
          tenantId: validated.tenantId,
          siteId: validated.siteId,
          ppeCompliancePct: String(output.ppe_compliance_pct),
          summary: output,
        })
        .onConflictDoNothing();
    }
  } catch (err) {
    deps.logger?.warn('safety-agent: db write skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createDefaultSafetyAgent(): SafetyAgent {
  let cached: SafetyAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createSafetyAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
