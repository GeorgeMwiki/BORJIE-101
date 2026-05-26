/**
 * Tutoring Skill Pack (Mining) — owner-onboarding tutorials junior.
 *
 * Mandate: generate context-aware "next thing to learn" cards for new
 * mining owners. Inputs: owner id, current onboarding step, recent
 * decisions in the LMBM. Outputs: a small prioritised array of tutorial
 * cards each linking to the in-app action the owner should take next
 * (e.g. PML renewal flow, gold-window submission form, MTC pre-flight).
 *
 * Distinct from the legacy estate `packages/tutoring-skill-pack`: this
 * junior is mining-domain and obeys AGENT_PROMPT_LIBRARY §0. Cards must
 * cite the source evidence (LMBM node id, licence expiry, etc.) — no
 * generic "you might also like" suggestions.
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  isoToday,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const TutorialPriority = z.enum(['urgent', 'soon', 'background']);
export type TutorialPriority = z.infer<typeof TutorialPriority>;

export const TutorialCard = z.object({
  title: z.string().min(1),
  body_md: z.string().min(1),
  action_url: z.string().min(1),
  priority: TutorialPriority,
});
export type TutorialCard = z.infer<typeof TutorialCard>;

export const TutoringSkillPackMiningInputSchema = z.object({
  tenantId: z.string().min(1),
  owner_id: z.string().min(1),
  current_step: z.string().min(1),
  language: z.enum(['sw', 'en']).default('sw'),
  recent_decisions: z
    .array(
      z.object({
        decision_id: z.string().min(1),
        kind: z.string().min(1),
        decided_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        evidence_id: z.string().min(1),
      }),
    )
    .default([]),
  upcoming_deadlines: z
    .array(
      z.object({
        kind: z.enum([
          'pml_renewal',
          'pl_renewal',
          'gold_window_submission',
          'royalty_payment',
          'nemc_permit',
          'mtc_pre_flight',
        ]),
        due_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        days_remaining: z.number().int(),
        evidence_id: z.string().min(1),
      }),
    )
    .default([]),
  max_cards: z.number().int().min(1).max(10).default(5),
});
export type TutoringSkillPackMiningInput = z.infer<typeof TutoringSkillPackMiningInputSchema>;

export const TutoringSkillPackMiningOutput = AuditedOutputBase.extend({
  tutorials: z.array(TutorialCard).max(10),
});
export type TutoringSkillPackMiningOutput = z.infer<typeof TutoringSkillPackMiningOutput>;

export const TUTORING_SKILL_PACK_MINING_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Tutoring Skill Pack (Mining)',
  mandate:
    'Generate the next 1-5 tutorial cards a new mining owner needs right now. Each card must cite the LMBM evidence_id ' +
    'that triggered it (an upcoming deadline, a recent decision, or the current onboarding step). Output is prioritised: ' +
    'urgent (compliance deadline within 14 days), soon (within 60 days), background (general learning).',
  tools: 'lmbm.read_owner_state, onboarding.read_progress, calendar.upcoming_deadlines.',
  evidence:
    'Every card MUST carry an evidence_id — either an upcoming_deadlines.evidence_id, a recent_decisions.evidence_id, ' +
    'or a corpus lookup id. Cards without evidence are rejected by the auditor.',
  outputSchema:
    '{ "tutorials": [{ "title": string, "body_md": string, "action_url": string, "priority": "urgent"|"soon"|"background" }], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.6,
  autonomyDomain: 'advisory; never opens a task or sends a notification — only surfaces cards',
  hardRules: [
    'Deadlines within 14 days MUST emit at least one "urgent" card.',
    'Action_url MUST be an in-app deep link (e.g. /onboarding/pml/renew) — never an external URL.',
    'Default language Swahili when language=sw; the card title may stay in English if the form name is English.',
    'Never surface more than max_cards entries.',
  ],
});

function buildUserPrompt(input: TutoringSkillPackMiningInput): string {
  return [
    `TENANT: ${input.tenantId}  OWNER: ${input.owner_id}  STEP: ${input.current_step}  LANG: ${input.language}  TODAY: ${isoToday()}`,
    `MAX_CARDS: ${input.max_cards}`,
    `UPCOMING_DEADLINES (${input.upcoming_deadlines.length}):`,
    JSON.stringify(input.upcoming_deadlines, null, 2).slice(0, 3_000),
    `RECENT_DECISIONS (${input.recent_decisions.length}):`,
    JSON.stringify(input.recent_decisions, null, 2).slice(0, 2_500),
  ].join('\n');
}

export function createTutoringSkillPackMiningAgent(deps: JuniorDeps) {
  return {
    async processInput(
      input: TutoringSkillPackMiningInput,
    ): Promise<TutoringSkillPackMiningOutput> {
      const validated = TutoringSkillPackMiningInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'tutoring-skill-pack-mining',
        schema: TutoringSkillPackMiningOutput,
        systemPrompt: TUTORING_SKILL_PACK_MINING_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2000,
      });
      return output;
    },
  };
}
export type TutoringSkillPackMiningAgent = ReturnType<typeof createTutoringSkillPackMiningAgent>;

export function createDefaultTutoringSkillPackMiningAgent(): TutoringSkillPackMiningAgent {
  let cached: TutoringSkillPackMiningAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createTutoringSkillPackMiningAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
