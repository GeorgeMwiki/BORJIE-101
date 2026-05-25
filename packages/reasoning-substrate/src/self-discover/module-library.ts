/**
 * Self-Discover reasoning module library.
 *
 * Implements the 39 atomic reasoning modules from Zhou et al. 2024
 * "Self-Discover: Large Language Models Self-Compose Reasoning
 * Structures" (https://arxiv.org/abs/2402.03620). Each primitive is a
 * short, composable reasoning operation; the SELECT meta-prompt picks
 * a subset, ADAPT rephrases them for the task class, and IMPLEMENT
 * emits a concrete JSON DAG.
 *
 * The 39 primitives are taken verbatim from Appendix C of the paper.
 * BORJIE adds 6 domain primitives (`apply-tz-rental-act`,
 * `check-currency-chain`, etc.) flagged with `domain: 'borjie'` so
 * they remain identifiable in the discovered structures and can be
 * promoted into the universal library by operator action.
 *
 * Pure data — no IO, no model calls. The SELECT meta-prompt embeds
 * this library verbatim so Claude can index by primitive id.
 */

export type ReasoningPrimitiveDomain = 'universal' | 'borjie';

export interface ReasoningPrimitive {
  readonly id: string;
  readonly description: string;
  readonly domain: ReasoningPrimitiveDomain;
  /**
   * Tags used by retrieval — when a task class mentions "arithmetic",
   * the SELECT prompt includes primitives tagged `arithmetic`.
   */
  readonly tags: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// 39 universal primitives (verbatim from Self-Discover Appendix C)
// ─────────────────────────────────────────────────────────────────────

export const UNIVERSAL_PRIMITIVES: ReadonlyArray<ReasoningPrimitive> = Object.freeze([
  { id: 'how-could-i-devise-an-experiment', description: 'How could I devise an experiment to help solve that problem?', domain: 'universal', tags: ['exploration'] },
  { id: 'make-list-of-ideas', description: 'Make a list of ideas for solving this problem and apply them one by one to the problem.', domain: 'universal', tags: ['exploration', 'enumeration'] },
  { id: 'measure-progress', description: 'How could I measure progress on this problem?', domain: 'universal', tags: ['metacognition'] },
  { id: 'simplify-problem', description: 'How can I simplify the problem so that it is easier to solve?', domain: 'universal', tags: ['simplification'] },
  { id: 'find-key-assumptions', description: 'What are the key assumptions underlying this problem?', domain: 'universal', tags: ['analysis'] },
  { id: 'risks-and-drawbacks', description: 'What are the potential risks and drawbacks of each solution?', domain: 'universal', tags: ['risk', 'verification'] },
  { id: 'consider-alternatives', description: 'What are the alternative perspectives or viewpoints on this problem?', domain: 'universal', tags: ['alternatives'] },
  { id: 'long-term-implications', description: 'What are the long-term implications of this problem and its solutions?', domain: 'universal', tags: ['evaluation'] },
  { id: 'creative-thinking', description: 'How can I think outside the box and come up with creative solutions?', domain: 'universal', tags: ['creative'] },
  { id: 'collaborative-solution', description: 'Is the problem one that requires a collaborative solution involving multiple parties?', domain: 'universal', tags: ['collaboration'] },
  { id: 'systems-thinking', description: 'Use systems thinking — consider the interconnectedness of various components.', domain: 'universal', tags: ['systems'] },
  { id: 'risk-analysis', description: 'Use risk analysis to evaluate potential risks, benefits, and tradeoffs.', domain: 'universal', tags: ['risk'] },
  { id: 'reflective-thinking', description: 'Use reflective thinking — examine assumptions, learn from past experiences.', domain: 'universal', tags: ['metacognition'] },
  { id: 'identify-core-issue', description: 'What is the core issue or problem that needs to be addressed?', domain: 'universal', tags: ['analysis'] },
  { id: 'identify-causes', description: 'What are the underlying causes contributing to the problem?', domain: 'universal', tags: ['root-cause'] },
  { id: 'potential-solutions', description: 'Are there any potential solutions or strategies that have been tried before?', domain: 'universal', tags: ['precedent'] },
  { id: 'measure-effectiveness', description: 'How can progress or success in solving the problem be measured?', domain: 'universal', tags: ['metacognition'] },
  { id: 'indicators-of-success', description: 'What indicators or metrics can be used to assess success?', domain: 'universal', tags: ['metacognition'] },
  { id: 'technical-problem', description: 'Is the problem a technical or practical one that requires a specific expertise?', domain: 'universal', tags: ['expertise'] },
  { id: 'analytical-decomposition', description: 'Is the problem an analytical one that requires data analysis and statistical methods?', domain: 'universal', tags: ['decomposition'] },
  { id: 'design-problem', description: 'Is the problem a design challenge that requires creative solutions?', domain: 'universal', tags: ['design'] },
  { id: 'policy-or-strategic', description: 'Does the problem require policy or strategic level intervention?', domain: 'universal', tags: ['policy'] },
  { id: 'physical-constraints', description: 'Are there physical or material constraints that need to be considered?', domain: 'universal', tags: ['constraints'] },
  { id: 'behavioural-aspect', description: 'Is the problem behavioural or psychological in nature?', domain: 'universal', tags: ['behaviour'] },
  { id: 'decision-making-problem', description: 'Is the problem one that involves decision making under uncertainty?', domain: 'universal', tags: ['decision'] },
  { id: 'analyse-from-different-angles', description: 'Analyse the problem from different perspectives.', domain: 'universal', tags: ['alternatives'] },
  { id: 'break-into-subproblems', description: 'Decompose the problem into smaller, more manageable parts.', domain: 'universal', tags: ['decomposition'] },
  { id: 'make-step-by-step-plan', description: 'Make a step-by-step plan and explain the rationale for each step.', domain: 'universal', tags: ['planning'] },
  { id: 'critical-thinking', description: 'Use critical thinking — analyse arguments and assess evidence.', domain: 'universal', tags: ['analysis'] },
  { id: 'apply-formula', description: 'Identify the correct formula or rule and apply it explicitly with substitutions.', domain: 'universal', tags: ['arithmetic', 'computation'] },
  { id: 'verify-with-edge-case', description: 'Construct an edge case and verify that the solution still holds.', domain: 'universal', tags: ['verification'] },
  { id: 'work-backwards', description: 'Work backwards from the desired outcome to identify what must be true.', domain: 'universal', tags: ['planning'] },
  { id: 'propose-and-verify', description: 'Propose a candidate answer and then verify it against the constraints.', domain: 'universal', tags: ['verification'] },
  { id: 'how-would-an-expert-think', description: 'How would a domain expert approach this problem?', domain: 'universal', tags: ['expertise'] },
  { id: 'gather-relevant-facts', description: 'Gather the relevant facts and evidence before reasoning.', domain: 'universal', tags: ['retrieval'] },
  { id: 'identify-relevant-rules', description: 'Identify the rules, regulations, or constraints that apply.', domain: 'universal', tags: ['rules'] },
  { id: 'compare-with-precedent', description: 'Compare the situation with a similar precedent and reason by analogy.', domain: 'universal', tags: ['precedent'] },
  { id: 'estimate-uncertainty', description: 'Estimate the uncertainty in the answer and surface it explicitly.', domain: 'universal', tags: ['uncertainty'] },
  { id: 'check-output-format', description: 'Check that the output matches the expected format / schema.', domain: 'universal', tags: ['format'] },
]);

// ─────────────────────────────────────────────────────────────────────
// BORJIE domain primitives (6 new)
// ─────────────────────────────────────────────────────────────────────

export const BORJIE_PRIMITIVES: ReadonlyArray<ReasoningPrimitive> = Object.freeze([
  { id: 'apply-tz-rental-act', description: 'Apply the TZ Rental Act provisions (notice periods, deposit handling, advance-rent caps) to the situation.', domain: 'borjie', tags: ['legal', 'rules', 'jurisdiction'] },
  { id: 'apply-ke-tenancy-rules', description: 'Apply the Kenya Rent Restriction Act provisions to the situation.', domain: 'borjie', tags: ['legal', 'rules', 'jurisdiction'] },
  { id: 'check-currency-chain', description: 'Resolve display currency via user → tenant → platform-default chain; convert via current FX rates.', domain: 'borjie', tags: ['currency', 'rules'] },
  { id: 'check-mediation-clause', description: 'Check whether the lease has mediation opt-in; if so, mediation must precede eviction.', domain: 'borjie', tags: ['legal', 'rules'] },
  { id: 'check-pii-boundary', description: 'Ensure no PII from another tenant leaks into the response.', domain: 'borjie', tags: ['privacy', 'verification'] },
  { id: 'check-payment-history', description: 'Pull the tenant payment history before any rent / arrears decision.', domain: 'borjie', tags: ['retrieval', 'finance'] },
]);

export const ALL_PRIMITIVES: ReadonlyArray<ReasoningPrimitive> = Object.freeze([
  ...UNIVERSAL_PRIMITIVES,
  ...BORJIE_PRIMITIVES,
]);

export function findPrimitiveById(id: string): ReasoningPrimitive | undefined {
  return ALL_PRIMITIVES.find((p) => p.id === id);
}

/**
 * Returns the count of primitives, broken down by domain. Useful as a
 * sanity check at module-load time.
 */
export function primitiveCounts(): { universal: number; borjie: number; total: number } {
  return {
    universal: UNIVERSAL_PRIMITIVES.length,
    borjie: BORJIE_PRIMITIVES.length,
    total: ALL_PRIMITIVES.length,
  };
}
