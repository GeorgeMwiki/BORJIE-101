/**
 * Safety / EHS Agent — critical controls, incident heatmap, PPE
 * issuance tracking (AGENT_PROMPT_LIBRARY §18).
 *
 * DEEPENED (Wave-3 Licence-to-Operate pillar): the agent now computes
 * the AUTHORITATIVE injury-frequency rates (TRIFR / LTIFR / fatality
 * rate, per million hours worked) and the ICMM Critical Control
 * Management (CCM) verification verdict DETERMINISTICALLY in
 * `safety-hse-metrics.ts`, then OVERRIDES any LLM-echoed figure with the
 * computed truth. HSE is a hard constraint, not a KPI (ICMM Principle 5,
 * `Docs/research/mining-esg-compliance.md` §1.1): any fatality or any
 * failed critical control raises an immediate, un-buffered owner alert.
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
import {
  assessCriticalControls,
  computeFrequencyRates,
  type CriticalControlRecord,
  type FrequencyInputs,
} from './safety-hse-metrics.js';

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

export const Severity = z.enum(['low', 'medium', 'high', 'critical']);

export const IncidentRecord = z.object({
  incident_id: z.string().min(1),
  iso_ts: z.string(),
  kind: IncidentKind,
  severity: Severity,
  site_id: z.string(),
  description: z.string(),
  site_section: z.string().optional(),
  photo_evidence_ids: z.array(z.string()).default([]),
});

export const PpeIssue = z.object({
  employee_id: z.string(),
  item: z.string(),
  issued_at: z.string(),
});

/** A critical control on the ICMM CCM register, supplied for verification. */
export const CriticalControlInput = z.object({
  control_id: z.string().min(1),
  control: z.string().min(1),
  mue: z.string().min(1),
  owner: z.string().optional(),
  verification_interval_days: z.number().int().positive(),
  days_since_last_verification: z.number().int().nonnegative().optional(),
  last_verification_passed: z.boolean().optional(),
});

export const SafetyAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  recent_incidents: z.array(IncidentRecord).default([]),
  ppe_issuance: z.array(PpeIssue).default([]),
  /** Total hours worked this window — the TRIFR/LTIFR denominator. */
  hours_worked: z.number().nonnegative().default(0),
  /** Prior-period rates for trend direction (optional). */
  prior_trifr: z.number().nonnegative().optional(),
  prior_ltifr: z.number().nonnegative().optional(),
  /** Critical-control register to field-verify deterministically. */
  critical_controls: z.array(CriticalControlInput).default([]),
  has_explosives_magazine: z.boolean().default(false),
  has_cyanide: z.boolean().default(false),
  has_mercury: z.boolean().default(false),
  norm_material_present: z.boolean().default(false),
});
export type SafetyAgentInput = z.infer<typeof SafetyAgentInputSchema>;

export const FrequencyRatesOut = z.object({
  hours_worked: z.number().nonnegative(),
  recordable_count: z.number().nonnegative(),
  lost_time_count: z.number().nonnegative(),
  fatality_count: z.number().nonnegative(),
  trifr: z.number().nonnegative(),
  ltifr: z.number().nonnegative(),
  fatality_rate: z.number().nonnegative(),
  trifr_trend: z.enum(['improving', 'worsening', 'flat', 'no_baseline']),
  ltifr_trend: z.enum(['improving', 'worsening', 'flat', 'no_baseline']),
  fatality_free: z.boolean(),
});

export const SafetyAgentOutput = AuditedOutputBase.extend({
  site_id: z.string(),
  /** Authoritative, deterministically-computed injury-frequency rates. */
  frequency_rates: FrequencyRatesOut.nullable().default(null),
  critical_controls: z.array(
    z.object({
      control_id: z.string().optional(),
      control: z.string(),
      mue: z.string().optional(),
      status: z.enum(['effective', 'degraded', 'failed', 'unverified', 'unknown']),
      overdue: z.boolean().optional(),
      owner_assigned: z.boolean().optional(),
    }),
  ),
  /** MUEs with no currently-effective guarding control (top field-verify targets). */
  exposed_mues: z.array(z.string()).default([]),
  incident_heatmap: z.array(
    z.object({ site_section: z.string(), severity_score: z.number().nonnegative(), count: z.number().int().nonnegative() }),
  ),
  ppe_compliance_pct: z.number().min(0).max(100),
  immediate_alerts: z.array(z.string()),
  required_actions: z.array(z.string()),
});
export type SafetyAgentOutput = z.infer<typeof SafetyAgentOutput>;

export const SAFETY_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Safety / EHS Agent',
  mandate:
    'Maintain ICMM CCM-aligned critical-control register, build incident heatmap, track PPE issuance, compute TRIFR/LTIFR per million hours worked, and surface immediate alerts for any injury / fatality. HSE is a hard constraint, not a KPI.',
  tools:
    'critical_controls, capture_toolbox_talk, log_incident, ppe_status, proximity_check, blast_permit_status, norm_status, frequency_rates.',
  evidence:
    'Cite the incident_id for every heatmap cell. Cite the worker_id + issued_at for every PPE compliance fraction. Cite the control_id for every critical-control verdict.',
  outputSchema:
    '{ "site_id": string, "frequency_rates": {...}|null, "critical_controls": [...], "exposed_mues": string[], ' +
    '"incident_heatmap": [...], "ppe_compliance_pct": number, "immediate_alerts": string[], ' +
    '"required_actions": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'monitoring + alerting; never issues PPE, signs off blast permits, or clears a critical control autonomously',
  hardRules: [
    'IMMEDIATELY alert the owner on any worker injury or fatality; do not buffer.',
    'A critical control may only be "effective" with a passed, in-date FIELD verification — never assert effectiveness without it (ICMM CCM).',
    'Refuse to advise blasting operations; only track lawful permits.',
    'Refuse mercury operational advice that increases exposure (Minamata-compliant abatement only).',
    'Refuse cyanidation advice without ICMC alignment + secondary containment.',
    'Refuse work within 60 m of a water source (NAWAPO 2002).',
  ],
});

function buildUserPrompt(input: SafetyAgentInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}`,
    `HOURS_WORKED: ${input.hours_worked}`,
    `FLAGS: explosives=${input.has_explosives_magazine} cyanide=${input.has_cyanide} mercury=${input.has_mercury} norm=${input.norm_material_present}`,
    `CRITICAL_CONTROLS (${input.critical_controls.length}):`,
    JSON.stringify(input.critical_controls, null, 2).slice(0, 2_500),
    `RECENT_INCIDENTS (${input.recent_incidents.length}):`,
    JSON.stringify(input.recent_incidents, null, 2).slice(0, 3_000),
    `PPE_ISSUANCE (${input.ppe_issuance.length}):`,
    JSON.stringify(input.ppe_issuance, null, 2).slice(0, 2_000),
  ].join('\n');
}

/** Tally incidents into the per-kind counts the frequency engine consumes. */
export function tallyInjuryCounts(
  incidents: ReadonlyArray<z.infer<typeof IncidentRecord>>,
): FrequencyInputs['injuries'] {
  const counts = {
    first_aid: 0,
    medical_treatment: 0,
    restricted_work: 0,
    lost_time_injury: 0,
    fatality: 0,
    near_miss: 0,
  };
  for (const i of incidents) {
    switch (i.kind) {
      case 'first_aid':
        counts.first_aid += 1;
        break;
      case 'medical_treatment':
        counts.medical_treatment += 1;
        break;
      case 'restricted_work':
        counts.restricted_work += 1;
        break;
      case 'lost_time_injury':
        counts.lost_time_injury += 1;
        break;
      case 'fatality':
        counts.fatality += 1;
        break;
      case 'near_miss':
        counts.near_miss += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

export function createSafetyAgent(deps: JuniorDeps) {
  return {
    async processInput(input: SafetyAgentInput): Promise<SafetyAgentOutput> {
      const validated = SafetyAgentInputSchema.parse(input);
      const llm = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'safety-agent',
        schema: SafetyAgentOutput,
        systemPrompt: SAFETY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

      // ── Deterministic authority: compute TRIFR/LTIFR + CCM verdicts and
      //    OVERRIDE the LLM echo. The model never owns these numbers.
      const rates =
        validated.hours_worked > 0 || validated.recent_incidents.length > 0
          ? computeFrequencyRates({
              injuries: tallyInjuryCounts(validated.recent_incidents),
              hours_worked: validated.hours_worked,
              ...(validated.prior_trifr !== undefined ? { prior_trifr: validated.prior_trifr } : {}),
              ...(validated.prior_ltifr !== undefined ? { prior_ltifr: validated.prior_ltifr } : {}),
            })
          : null;

      const ccm =
        validated.critical_controls.length > 0
          ? assessCriticalControls(validated.critical_controls as ReadonlyArray<CriticalControlRecord>)
          : null;

      // ── Un-buffered immediate alerts on the hard-constraint breaches.
      const alerts = new Set<string>(llm.immediate_alerts);
      if (rates && !rates.fatality_free) {
        alerts.add(`FATALITY recorded at site ${validated.siteId} — escalate to owner immediately (ICMM Principle 5).`);
      }
      if (ccm) {
        for (const id of ccm.failed_control_ids) {
          alerts.add(`Critical control ${id} FAILED its last field verification — Material Unwanted Event exposed.`);
        }
        for (const mue of ccm.exposed_mues) {
          alerts.add(`No effective critical control for "${mue}" — prioritise field verification.`);
        }
      }

      const output: SafetyAgentOutput = {
        ...llm,
        frequency_rates: rates,
        critical_controls: ccm
          ? ccm.controls.map((c) => ({
              control_id: c.control_id,
              control: c.control,
              mue: c.mue,
              status: c.status,
              overdue: c.overdue,
              owner_assigned: c.owner_assigned,
            }))
          : llm.critical_controls,
        exposed_mues: ccm ? [...ccm.exposed_mues] : llm.exposed_mues,
        immediate_alerts: [...alerts],
      };

      if (deps.db) {
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
          deps.logger?.warn('safety-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type SafetyAgent = ReturnType<typeof createSafetyAgent>;

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
