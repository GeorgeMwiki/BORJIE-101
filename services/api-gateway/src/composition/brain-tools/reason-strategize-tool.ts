/**
 * RT-7 — mwikila.reason.strategize
 *
 * Orchestrates multi-step strategic reasoning for owner questions of
 * the form "what should I do?". Returns a structured StrategyTrace
 * the chat turn uses AS CONTEXT — Mr. Mwikila composes the narrative
 * reply himself.
 *
 * Design rules:
 *   - LOW stakes, read-only. No money path. No write side effects.
 *   - Available to T1 owner, T2 admin, T3 manager (anyone who might
 *     be asked "what should we do here?"). Worker + buyer kept out.
 *   - Deterministic at the tool layer: the scaffolding is built from
 *     the question + scope filter + recent activity, all visible to
 *     the test harness. Variation happens at the model layer.
 *   - The compose_guidance field instructs the model how to render
 *     the StrategyTrace into a warm, persona-consistent narrative.
 *
 * The tool does NOT call out to external services — it provides the
 * SHAPE the model fills in by reasoning. The model is the strategist;
 * the tool is the scaffold.
 */

import { z } from 'zod';

import type { PersonaToolDescriptor } from './types';

const ReasonStrategizeInput = z
  .object({
    /**
     * The owner's strategic question, in their own words.
     * Examples: "should I expand to Geita next month",
     * "what do I do about the late royalty filing".
     */
    question: z.string().min(3).max(500),
    /**
     * Optional scope filter — narrows the reasoning to a specific
     * entity (site, licence, decision, vendor). The model may use
     * this to focus the entity-search calls that ground each strategy.
     */
    scope_filter: z
      .object({
        entity_type: z
          .enum([
            'site',
            'licence',
            'decision',
            'vendor',
            'workforce',
            'mineral',
            'contract',
            'royalty',
          ])
          .optional(),
        entity_id: z.string().min(1).max(120).optional(),
      })
      .optional(),
    /**
     * Reasoning depth. 'quick' returns 2 strategies; 'thorough' returns
     * 3-4 with deeper evidence prompts. Defaults to 'quick' to keep
     * latency tight on the common path.
     */
    depth: z.enum(['quick', 'thorough']).optional().default('quick'),
    /**
     * Language hint for the bilingual prompts. Defaults to 'en'.
     */
    language: z.enum(['en', 'sw']).optional().default('en'),
  })
  .strict();

const StrategySchema = z
  .object({
    name: z.string().min(1),
    pros: z.array(z.string().min(1)).min(1).max(5),
    cons: z.array(z.string().min(1)).min(1).max(5),
    evidence_prompt: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type StrategyShape = z.infer<typeof StrategySchema>;

const StrategyTraceSchema = z
  .object({
    current_state_prompt: z.string().min(1),
    constraints: z.array(z.string().min(1)).min(1).max(8),
    strategies: z.array(StrategySchema).min(2).max(4),
    recommended_index: z.number().int().min(0),
    why_prompt: z.string().min(1),
    downsides_prompt: z.string().min(1),
    retrospective_grade_plan: z.string().min(1),
  })
  .strict();

const ReasonStrategizeOutput = z
  .object({
    question: z.string(),
    scope_filter: z
      .object({
        entity_type: z.string().optional(),
        entity_id: z.string().optional(),
      })
      .nullable(),
    depth: z.enum(['quick', 'thorough']),
    trace: StrategyTraceSchema,
    /**
     * The grounding tools the MODEL should call to fill in the
     * `*_prompt` fields with live data. The tool itself does not
     * call them — naming them here lets the orchestrator decide.
     */
    grounding_tools: z.array(z.string().min(1)).min(1),
    /**
     * RT-5 — REASONING DIRECTIVE. The StrategyTrace is a SCAFFOLD
     * for the model's fresh, owner-facing composition. Not a script.
     */
    compose_guidance: z.string().min(1),
  })
  .strict();

const ALLOWED_PERSONAS = [
  'T1_owner_strategist',
  'T2_admin_strategist',
  'T3_module_manager',
] as const;

const COMPOSE_GUIDANCE =
  'REASON: This StrategyTrace is a SCAFFOLD. Fill in the *_prompt fields ' +
  "using the grounding tools (entity search, scope query, recent " +
  "decisions, jurisdiction context). Compose a warm, plain-text " +
  "narrative for the owner in their active language. Walk them through: " +
  '(1) the current state from THEIR data, (2) the constraints, (3) the ' +
  "strategies with tradeoffs, (4) your recommendation with explicit " +
  "WHY, (5) a retrospective grade plan ('here is how we will know we " +
  "picked right in 30 days'). NEVER quote this scaffold verbatim. Vary " +
  'phrasing per turn — the owner expects a thinking advisor, not a ' +
  'template.';

const GROUNDING_TOOLS: ReadonlyArray<string> = Object.freeze([
  'mwikila.scope.search',
  'mwikila.entity.find',
  'mwikila.jurisdiction.show_current',
  'mwikila.opportunity.scan',
  'mwikila.risk.scan',
]);

const QUICK_STRATEGIES: ReadonlyArray<StrategyShape> = Object.freeze([
  Object.freeze({
    name: 'Hold and verify',
    pros: Object.freeze([
      'Lowest cash risk',
      'Buys time for missing evidence',
    ]) as unknown as string[],
    cons: Object.freeze([
      'May miss the window if competitors move',
      'Owner perceived as slow',
    ]) as unknown as string[],
    evidence_prompt:
      'Pull recent decisions in this scope and check whether key evidence is still missing. Cite specific entity ids.',
    confidence: 0.65,
  }),
  Object.freeze({
    name: 'Move now with the data we have',
    pros: Object.freeze([
      'Captures the window',
      'Signals decisiveness',
    ]) as unknown as string[],
    cons: Object.freeze([
      'Exposed to compliance risk if evidence weak',
      'Cash drawdown',
    ]) as unknown as string[],
    evidence_prompt:
      'Summarise the available evidence (production, compliance, cash) for THIS owner from the scope tool. Cite ids.',
    confidence: 0.55,
  }),
]) as unknown as StrategyShape[];

const THOROUGH_EXTRA_STRATEGIES: ReadonlyArray<StrategyShape> = Object.freeze([
  Object.freeze({
    name: 'Partial commitment — pilot then expand',
    pros: Object.freeze([
      'De-risks the move with a small bet',
      'Generates real data for the bigger decision',
    ]) as unknown as string[],
    cons: Object.freeze([
      'Slower than full commitment',
      'Pilot may not generalise',
    ]) as unknown as string[],
    evidence_prompt:
      'Identify a smallest viable pilot from the scope. Cite the site / licence / contract id that would be the pilot.',
    confidence: 0.7,
  }),
  Object.freeze({
    name: 'Decline and pivot',
    pros: Object.freeze([
      'Preserves capital for higher-EV moves',
      'Avoids commitment to a thinning thesis',
    ]) as unknown as string[],
    cons: Object.freeze([
      'Forgone upside if this turned out to be the right move',
      'Owner needs a credible alternative',
    ]) as unknown as string[],
    evidence_prompt:
      'Surface 1-2 higher-EV opportunities from mwikila.opportunity.scan and contrast their evidence.',
    confidence: 0.5,
  }),
]) as unknown as StrategyShape[];

const buildTrace = (
  depth: 'quick' | 'thorough',
): z.infer<typeof StrategyTraceSchema> => {
  const strategies: StrategyShape[] =
    depth === 'thorough'
      ? [...QUICK_STRATEGIES, ...THOROUGH_EXTRA_STRATEGIES]
      : [...QUICK_STRATEGIES];
  // Pick the strategy with the highest confidence as the default
  // recommendation. The model may override after grounding with live
  // data — this is a starting point.
  let recommendedIndex = 0;
  let topConfidence = -Infinity;
  strategies.forEach((s, i) => {
    if (s.confidence > topConfidence) {
      topConfidence = s.confidence;
      recommendedIndex = i;
    }
  });
  return {
    current_state_prompt:
      'Describe the current state from the owner\'s OWN data: which sites are active, what cash position, what recent decisions in scope. Cite entity ids.',
    constraints: [
      'Cash on hand and 30-day burn',
      'Active compliance windows (licence expiry, royalty deadline)',
      'Workforce capacity in the affected scope',
      'Counterparty / buyer commitments already in flight',
    ],
    strategies,
    recommended_index: recommendedIndex,
    why_prompt:
      'Explain WHY the recommended strategy fits THIS owner THIS week. Reference the constraints by name and the evidence gathered from grounding tools.',
    downsides_prompt:
      'Name 1-2 specific things that could go wrong with the recommendation and what early warning signs to watch for.',
    retrospective_grade_plan:
      'Tell the owner how we will know in 30 / 60 / 90 days whether the recommendation was right. Cite the specific metric (production tonnes, royalty filed on time, cash runway) that grades this decision.',
  };
};

export const reasonStrategizeTool: PersonaToolDescriptor<
  typeof ReasonStrategizeInput,
  typeof ReasonStrategizeOutput
> = {
  id: 'mwikila.reason.strategize',
  name: 'Multi-step strategic reasoning scaffold',
  description:
    'Use when the owner asks any strategic question of the form ' +
    '"what should I do?" / "should I X or Y?" / "is now the right time?" / ' +
    'Swahili "nifanyeje?" / "ni wakati sahihi?". Returns a STRUCTURED ' +
    'STRATEGY TRACE the chat turn uses as CONTEXT — the model composes ' +
    'the warm, owner-facing narrative itself using live entity / scope / ' +
    'jurisdiction grounding. The trace contains: current state prompt, ' +
    'constraints, 2-4 plausible strategies with pros / cons / confidence / ' +
    'evidence prompt, a recommended_index, a why prompt, a downsides ' +
    'prompt, and a retrospective grade plan. Use depth="thorough" for ' +
    'high-stakes decisions; default depth="quick" for fast turns.',
  personaSlugs: ALLOWED_PERSONAS,
  inputSchema: ReasonStrategizeInput,
  outputSchema: ReasonStrategizeOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    const depth = input.depth ?? 'quick';
    const trace = buildTrace(depth);
    return {
      question: input.question,
      scope_filter: input.scope_filter
        ? {
            ...(input.scope_filter.entity_type !== undefined && {
              entity_type: input.scope_filter.entity_type,
            }),
            ...(input.scope_filter.entity_id !== undefined && {
              entity_id: input.scope_filter.entity_id,
            }),
          }
        : null,
      depth,
      trace,
      grounding_tools: [...GROUNDING_TOOLS],
      compose_guidance: COMPOSE_GUIDANCE,
    };
  },
};

export const REASON_STRATEGIZE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  reasonStrategizeTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
