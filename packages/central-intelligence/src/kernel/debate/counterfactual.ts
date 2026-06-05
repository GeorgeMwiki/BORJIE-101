/**
 * Counterfactual reasoning — "what if" perturbations of the question.
 *
 * Forces the brain to imagine alternative paths so it doesn't anchor
 * on the actual present. Three standardised perturbations per domain
 * (e.g. for `rent`: price +30%, price -30%, market shock) keep the
 * surface area small and auditable.
 *
 * NOTE — the `CounterfactualDomain` key values and the per-template
 * `idSuffix`es are a public contract (re-exported from kernel/index.ts
 * and pinned by the debate tests). They are kept verbatim; only the
 * perturbation prose carries mining vocabulary.
 */

import type { DebateDeps } from './debate-types.js';

export type CounterfactualDomain =
  | 'rent'
  | 'vacancy'
  | 'collection'
  | 'maintenance'
  | 'tenant-quality';

export interface CounterfactualScenario {
  readonly id: string;
  /** The original question (unchanged across scenarios). */
  readonly question: string;
  /** The perturbation (e.g. "if the offtake price were 30% higher"). */
  readonly perturbation: string;
}

export interface CounterfactualOutcome {
  readonly scenarioId: string;
  readonly answer: string;
  readonly latencyMs: number;
}

interface PerturbationTemplate {
  readonly idSuffix: string;
  readonly perturbation: string;
}

const TEMPLATES: Record<CounterfactualDomain, ReadonlyArray<PerturbationTemplate>> = {
  rent: [
    { idSuffix: 'rent-up-30',     perturbation: 'if the offtake price were 30% higher than current' },
    { idSuffix: 'rent-down-30',   perturbation: 'if the offtake price were 30% lower than current' },
    { idSuffix: 'rent-mkt-shock', perturbation: 'if a market shock cut comparable mineral prices by 20% this quarter' },
  ],
  vacancy: [
    { idSuffix: 'vac-doubled',    perturbation: 'if spare capacity doubled relative to last quarter' },
    { idSuffix: 'vac-zero',       perturbation: 'if spare capacity fell to zero across the portfolio' },
    { idSuffix: 'vac-seasonal',   perturbation: 'if a seasonal exodus removed 25% of counterparties in 60 days' },
  ],
  collection: [
    { idSuffix: 'coll-down-15',   perturbation: 'if royalty collection dropped by 15 percentage points' },
    { idSuffix: 'coll-perfect',   perturbation: 'if royalty collection were 100% on every agreement this month' },
    { idSuffix: 'coll-arrears',   perturbation: 'if 30% of counterparties fell into outstanding royalties simultaneously' },
  ],
  maintenance: [
    { idSuffix: 'maint-spike-3x', perturbation: 'if maintenance work-orders spiked 3× over baseline' },
    { idSuffix: 'maint-quiet',    perturbation: 'if maintenance volume fell 50% with no underlying issue uptick' },
    { idSuffix: 'maint-emerg',    perturbation: 'if a single site emergency consumed the monthly maintenance budget' },
  ],
  'tenant-quality': [
    { idSuffix: 'tq-improved',    perturbation: 'if counterparty credit quality improved one full grade band across the book' },
    { idSuffix: 'tq-declined',    perturbation: 'if counterparty credit quality declined one full grade band across the book' },
    { idSuffix: 'tq-mix-shift',   perturbation: 'if the counterparty mix shifted from long-term offtakes to spot sales' },
  ],
};

/**
 * Build the three standardised counterfactual scenarios for a domain.
 * The original `question` is carried verbatim into each scenario so
 * the runner can pair it with the perturbation in the prompt.
 */
export function buildCounterfactuals(
  question: string,
  domain: CounterfactualDomain,
): ReadonlyArray<CounterfactualScenario> {
  const templates = TEMPLATES[domain];
  return templates.map((t) => ({
    id: `cf-${domain}-${t.idSuffix}`,
    question,
    perturbation: t.perturbation,
  }));
}

/**
 * Run counterfactuals — one sensor call per scenario. Each scenario
 * gets a system prompt that pins the counterfactual frame and a
 * user message combining the question, the perturbation, and the
 * shared context.
 */
export async function runCounterfactuals(
  scenarios: ReadonlyArray<CounterfactualScenario>,
  context: string,
  deps: DebateDeps,
): Promise<ReadonlyArray<CounterfactualOutcome>> {
  const clock = deps.clock ?? (() => Date.now());
  const outcomes: CounterfactualOutcome[] = [];
  for (const sc of scenarios) {
    const userMessage = renderScenarioPrompt(sc, context);
    const start = clock();
    const result = await deps.sensor.call({
      system: COUNTERFACTUAL_SYSTEM_PROMPT,
      userMessage,
      priorTurns: [],
      extendedThinking: false,
      stakes: 'medium',
    });
    const latencyMs = Math.max(0, clock() - start);
    outcomes.push({
      scenarioId: sc.id,
      answer: result.text ?? '',
      latencyMs,
    });
  }
  return outcomes;
}

const COUNTERFACTUAL_SYSTEM_PROMPT =
  'You are a counterfactual reasoner. Given a question, a perturbation, and a shared context, answer AS IF the perturbation were already true. Do not hedge with "in reality" — answer the alternative world directly. Be specific and concrete.';

function renderScenarioPrompt(
  sc: CounterfactualScenario,
  context: string,
): string {
  return [
    `Question:\n${sc.question}`,
    '',
    `Perturbation: ${sc.perturbation}`,
    '',
    `Context:\n${context || '(none)'}`,
    '',
    'Answer the question as if the perturbation were already true.',
  ].join('\n');
}
