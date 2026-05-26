/**
 * Safety / EHS Agent — critical controls, incident heatmap, PPE
 * issuance tracking (AGENT_PROMPT_LIBRARY §18).
 *
 * Schema gap: `safety_snapshots` raw SQL; TODO(#30).
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
  photo_evidence_ids: z.array(z.string()).default([]),
});

export const PpeIssue = z.object({
  employee_id: z.string(),
  item: z.string(),
  issued_at: z.string(),
});

export const SafetyAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  siteId: z.string().min(1),
  recent_incidents: z.array(IncidentRecord).default([]),
  ppe_issuance: z.array(PpeIssue).default([]),
  has_explosives_magazine: z.boolean().default(false),
  has_cyanide: z.boolean().default(false),
  has_mercury: z.boolean().default(false),
  norm_material_present: z.boolean().default(false),
});
export type SafetyAgentInput = z.infer<typeof SafetyAgentInputSchema>;

export const SafetyAgentOutput = AuditedOutputBase.extend({
  site_id: z.string(),
  critical_controls: z.array(
    z.object({ control: z.string(), status: z.enum(['effective', 'degraded', 'failed', 'unknown']) }),
  ),
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
    'Maintain ICMM CCM-aligned critical-control register, build incident heatmap, track PPE issuance, surface immediate alerts for any injury / fatality.',
  tools:
    'critical_controls, capture_toolbox_talk, log_incident, ppe_status, proximity_check, blast_permit_status, norm_status.',
  evidence:
    'Cite the incident_id for every heatmap cell. Cite the worker_id + issued_at for every PPE compliance fraction.',
  outputSchema:
    '{ "site_id": string, "critical_controls": [...], "incident_heatmap": [...], "ppe_compliance_pct": number, ' +
    '"immediate_alerts": string[], "required_actions": string[], "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.85,
  autonomyDomain: 'monitoring + alerting; never issues PPE or signs off blast permits autonomously',
  hardRules: [
    'IMMEDIATELY alert the owner on any worker injury or fatality; do not buffer.',
    'Refuse to advise blasting operations; only track lawful permits.',
    'Refuse mercury operational advice that increases exposure (Minamata-compliant abatement only).',
    'Refuse cyanidation advice without ICMC alignment + secondary containment.',
    'Refuse work within 60 m of a water source (NAWAPO 2002).',
  ],
});

function buildUserPrompt(input: SafetyAgentInput): string {
  return [
    `TENANT: ${input.tenantId}  SITE: ${input.siteId}`,
    `FLAGS: explosives=${input.has_explosives_magazine} cyanide=${input.has_cyanide} mercury=${input.has_mercury} norm=${input.norm_material_present}`,
    `RECENT_INCIDENTS (${input.recent_incidents.length}):`,
    JSON.stringify(input.recent_incidents, null, 2).slice(0, 3_500),
    `PPE_ISSUANCE (${input.ppe_issuance.length}):`,
    JSON.stringify(input.ppe_issuance, null, 2).slice(0, 2_500),
  ].join('\n');
}

export function createSafetyAgent(deps: JuniorDeps) {
  return {
    async processInput(input: SafetyAgentInput): Promise<SafetyAgentOutput> {
      const validated = SafetyAgentInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'safety-agent',
        schema: SafetyAgentOutput,
        systemPrompt: SAFETY_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2500,
      });

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
