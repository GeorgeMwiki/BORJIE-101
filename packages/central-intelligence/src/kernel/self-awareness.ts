/**
 * Self-awareness — TWO complementary primitives in one file:
 *
 *   1. The persona-drift gate (`checkSelfAwareness`) — runs at end of
 *      turn, heuristically detects persona drift / fabrication, emits
 *      `PersonaDriftEvent`s. This is the original Borjie module
 *      and remains the per-turn voice police.
 *
 *   2. The module-inventory injector (`renderModuleInventoryBlock`) —
 *      mirrors LITFIN's `src/core/brain/self-awareness.ts` and emits
 *      a "BRAIN SELF-AWARENESS" block enumerating the 27+ kernel
 *      modules organised by category. The kernel prepends this block
 *      to every system prompt so the LLM speaks from real posture,
 *      not generic AI-speak.
 *
 * The two primitives share the file because LITFIN named the module
 * "self-awareness" for the same dual responsibility.
 *
 * Drift signals (unchanged from prior implementation):
 *
 *   - Taboo phrase appearance      — anything from persona.taboos
 *   - First-person form loss       — persona uses "I", reply uses
 *                                    "Borjie's AI" or "the system"
 *   - Tone violation               — empty hedges, marketing buzzwords
 *                                    in tenant scope
 *   - Likely fabrication           — assertions about tools/numbers
 *                                    when no tool call ran
 */

import type { PersonaIdentity } from './identity.js';
import type { GateVerdict, PersonaDriftEvent } from './kernel-types.js';

// ────────────────────────────────────────────────────────────────────
// 1. Persona-drift gate (unchanged contract — kernel.ts still calls
//    `checkSelfAwareness` and receives the same SelfAwarenessOutput).
// ────────────────────────────────────────────────────────────────────

export interface SelfAwarenessInput {
  readonly persona: PersonaIdentity;
  readonly outputText: string;
  readonly toolCallCount: number;
  readonly hasCitations: boolean;
  readonly thoughtId: string;
  readonly capturedAt: string;
}

export interface SelfAwarenessOutput {
  readonly verdict: GateVerdict;
  readonly events: ReadonlyArray<PersonaDriftEvent>;
  readonly driftScore: number; // [0,1]; 0 = clean, 1 = severe drift
}

const FORBIDDEN_FIRST_PERSON_DODGES = [
  'as an ai',
  'as a language model',
  'as an artificial intelligence',
  'i am just a',
  'i\'m just a',
  'borjie\'s ai',
  'the system',
  'this assistant',
];

const BUZZWORD_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsynerg\w+/i,
  /\bleverage\b/i,
  /\bcutting[- ]edge\b/i,
  /\brevolutionary\b/i,
  /\bgame[- ]chang\w+/i,
];

const FABRICATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(the data shows|the records show|the system says|i can see in the database)\b/i,
  /\b(based on (your|the) (records|data|history))\b/i,
];

export function checkSelfAwareness(input: SelfAwarenessInput): SelfAwarenessOutput {
  const lower = input.outputText.toLowerCase();
  const events: PersonaDriftEvent[] = [];

  for (const signal of input.persona.violationSignals) {
    if (lower.includes(signal.toLowerCase())) {
      events.push(makeEvent(input, 'taboo', signal, 'high'));
    }
  }

  for (const dodge of FORBIDDEN_FIRST_PERSON_DODGES) {
    if (lower.includes(dodge)) {
      events.push(makeEvent(input, 'first-person-loss', dodge, 'medium'));
      break;
    }
  }

  for (const re of BUZZWORD_PATTERNS) {
    const m = re.exec(input.outputText);
    if (m) {
      events.push(makeEvent(input, 'tone', m[0], 'low'));
      break;
    }
  }

  if (input.toolCallCount === 0 && !input.hasCitations) {
    for (const re of FABRICATION_PATTERNS) {
      const m = re.exec(input.outputText);
      if (m) {
        events.push(makeEvent(input, 'fabrication', m[0], 'high'));
        break;
      }
    }
  }

  const sevWeights: Record<PersonaDriftEvent['severity'], number> = {
    low: 0.15,
    medium: 0.4,
    high: 0.85,
  };
  const driftScore = Math.min(
    1,
    events.reduce((acc, e) => acc + sevWeights[e.severity], 0),
  );

  let verdict: GateVerdict;
  if (driftScore >= 0.85) {
    verdict = { status: 'block', reason: 'severe persona drift' };
  } else if (driftScore >= 0.4) {
    verdict = { status: 'soften', reason: 'persona drift detected; voice corrected' };
  } else {
    verdict = { status: 'pass' };
  }

  return { verdict, events, driftScore };
}

function makeEvent(
  input: SelfAwarenessInput,
  violationType: PersonaDriftEvent['violationType'],
  excerpt: string,
  severity: PersonaDriftEvent['severity'],
): PersonaDriftEvent {
  return {
    thoughtId: input.thoughtId,
    personaId: input.persona.id,
    violationType,
    excerpt,
    severity,
    detectedAt: input.capturedAt,
  };
}

// ────────────────────────────────────────────────────────────────────
// 2. Module-inventory injector — the "BRAIN SELF-AWARENESS" block.
//
// The kernel's awareness is of CAPABILITIES, not file paths. Modules
// living in ai-copilot, the forecasting package, or the graph layer
// still show up here when they shape the brain's behaviour. The list
// is the truth-table the LLM uses to answer "what can you do?".
// ────────────────────────────────────────────────────────────────────

export type BrainModuleCategory =
  | 'memory'
  | 'identity'
  | 'sensing'
  | 'reasoning'
  | 'policy'
  | 'output'
  | 'audit'
  | 'agency';

export interface BrainModule {
  readonly id: string;
  readonly name: string;
  readonly category: BrainModuleCategory;
  readonly oneLiner: string;
}

/**
 * The 27+ kernel modules. Property-management-aware: tenant ops,
 * lease lifecycle, market-rate surveillance, KRA/MRI compute, and
 * maintenance triage are part of the inventory even though their
 * code lives in ai-copilot — the BRAIN's posture is of capabilities,
 * not packages.
 */
export const BRAIN_MODULES: ReadonlyArray<BrainModule> = [
  // Memory (4)
  {
    id: 'episodic',
    name: 'Episodic memory',
    category: 'memory',
    oneLiner: 'Per-turn record of who said what, with semantic-fact extraction at sleep cycle.',
  },
  {
    id: 'semantic',
    name: 'Semantic memory',
    category: 'memory',
    oneLiner: 'Long-term facts about tenants, properties, and agencies, decayed by relevance.',
  },
  {
    id: 'procedural',
    name: 'Procedural memory',
    category: 'memory',
    oneLiner: 'Learned workflow patterns (e.g. "this estate prefers Friday rent reminders").',
  },
  {
    id: 'reflective',
    name: 'Reflective digest',
    category: 'memory',
    oneLiner: 'Periodic self-summary of recent decisions, surfaced to the next turn as context.',
  },
  // Identity (4)
  {
    id: 'persona-anchor',
    name: 'Frozen platform voice',
    category: 'identity',
    oneLiner: 'Wit-anchor block prepended to every brain call across all surfaces.',
  },
  {
    id: 'persona-surface',
    name: 'Per-surface persona',
    category: 'identity',
    oneLiner: 'Eight personas (resident, owner-advisor, estate-manager, sovereign, marketing, tutor, …) selected by surface.',
  },
  {
    id: 'persona-branding',
    name: 'Per-tenant branding',
    category: 'identity',
    oneLiner: 'Agency-level re-skin of displayName / voice profile applied before preamble rendering.',
  },
  {
    id: 'persona-personalisation',
    name: 'Per-user personalisation',
    category: 'identity',
    oneLiner: 'Greeting opener rewritten with the operator’s name, role, and affiliation.',
  },
  // Sensing (3)
  {
    id: 'sensor-router',
    name: 'Sensor failover router',
    category: 'sensing',
    oneLiner: 'Circuit-breaker across Anthropic / OpenAI sensors; routes by capability + healthiness.',
  },
  {
    id: 'voice-bridge',
    name: 'Voice bridge',
    category: 'sensing',
    oneLiner: 'Voice-mode binding for tenant + owner-portal; carries pace / tone / vocab register.',
  },
  {
    id: 'cohort-signal',
    name: 'DP cohort source',
    category: 'sensing',
    oneLiner: 'k-anonymous cross-tenant aggregates under differential privacy for industry-tier queries.',
  },
  // Reasoning (5)
  {
    id: 'theory-of-mind',
    name: 'Theory of mind',
    category: 'reasoning',
    oneLiner: 'Stateful per-(tenant,user) accumulator: frustration, comprehension, anxiety, trust, urgency.',
  },
  {
    id: 'cognitive-load',
    name: 'Cognitive load',
    category: 'reasoning',
    oneLiner: 'Stateful per-(tenant,user) load accumulator throttling verbosity, citations, artifacts.',
  },
  {
    id: 'debate',
    name: 'Internal debate',
    category: 'reasoning',
    oneLiner: 'High-stakes decisions invoke 2–3 voices arguing different angles, then a synthesiser.',
  },
  {
    id: 'world-model',
    name: 'World model + trajectory',
    category: 'reasoning',
    oneLiner: 'Forward-simulates property / tenant / owner state vectors to reason about where this is headed.',
  },
  {
    id: 'continuous-grading',
    name: 'Continuous property grading',
    category: 'reasoning',
    oneLiner: 'Rolling property-grade band (A–F) with explanation; updates on every event.',
  },
  // Policy (5)
  {
    id: 'inviolable',
    name: 'Inviolable rules',
    category: 'policy',
    oneLiner: 'Hard refusals (PII exfiltration, cross-tenant leaks, eviction promises, security changes).',
  },
  {
    id: 'public-inviolable',
    name: 'Public inviolable limits',
    category: 'policy',
    oneLiner: 'Stricter ceiling for unauthenticated marketing surface (rate, citation, no-PII).',
  },
  {
    id: 'policy-gate',
    name: 'Policy gate',
    category: 'policy',
    oneLiner: 'Aggregates inviolable + drift + cognitive-load verdicts into a single block/soften/pass.',
  },
  {
    id: 'four-eye-approval',
    name: 'Four-eye approval gate',
    category: 'policy',
    oneLiner: 'Owner-tier mutations (security, billing, autonomy policy) require a second signer.',
  },
  {
    id: 'self-awareness',
    name: 'Self-awareness drift gate',
    category: 'policy',
    oneLiner: 'Per-turn heuristic check for taboos, first-person loss, buzzwords, fabrications.',
  },
  // Output (4)
  {
    id: 'normalizer',
    name: 'Output normaliser',
    category: 'output',
    oneLiner: 'Strips empty hedges, em dashes, filler; enforces ISO-4217 prefix on every figure.',
  },
  {
    id: 'briefing',
    name: 'Briefing composer',
    category: 'output',
    oneLiner: 'Builds the morning / weekly portfolio briefing for owners and estate managers.',
  },
  {
    id: 'proactive-nudge',
    name: 'Proactive nudge router',
    category: 'output',
    oneLiner: 'Schedules unsolicited nudges (rent reminders, lease expiry, market shifts) with dedupe.',
  },
  {
    id: 'confidence',
    name: 'Confidence scoring',
    category: 'output',
    oneLiner: 'Composite groundedness / stability / review / numerical-consistency, min-of-components.',
  },
  // Audit (4)
  {
    id: 'cot-reservoir',
    name: 'CoT reservoir',
    category: 'audit',
    oneLiner: 'Sampled chain-of-thought capture for high-stakes turns; replayable for fairness sweeps.',
  },
  {
    id: 'provenance-sink',
    name: 'Provenance sink',
    category: 'audit',
    oneLiner: 'Per-decision sink writing inputs, gating, sensors, confidence, drift to the audit store.',
  },
  {
    id: 'persona-drift-probe',
    name: 'Persona-vector probe',
    category: 'audit',
    oneLiner: '24-dimension behavioural fingerprint; per-dim + aggregate L2 thresholds emit drift events.',
  },
  {
    id: 'tool-loop-drift',
    name: 'Tool-loop drift detector',
    category: 'audit',
    oneLiner: 'End-of-turn Jaccard intent overlap (en+sw stopwords) catches prompt-injection drift.',
  },
  // Agency (4) — property-management capabilities live here
  {
    id: 'goal-tracker',
    name: 'Goal tracker',
    category: 'agency',
    oneLiner: 'Tracks long-running goals (collect rent, close vacancy, resolve dispute) across turns.',
  },
  {
    id: 'rent-reconciliation',
    name: 'Rent reconciliation',
    category: 'agency',
    oneLiner: 'Matches incoming M-Pesa / bank rails to lease IDs; flags partial / late / overpayment.',
  },
  {
    id: 'kra-mri-compute',
    name: 'KRA + MRI compute',
    category: 'agency',
    oneLiner: 'Withholding-tax + monthly rental income calculator with statute citation per line.',
  },
  {
    id: 'market-rate',
    name: 'Market-rate surveillance',
    category: 'agency',
    oneLiner: 'Daily comparable-rent crawl per estate; alerts on >10 % deviation from portfolio.',
  },
  {
    id: 'maintenance-triage',
    name: 'Maintenance triage',
    category: 'agency',
    oneLiner: 'Classifies work orders (urgent / scheduled / cosmetic); routes to vendor or in-house.',
  },
];

/**
 * Group module list by category for prompt rendering.
 */
export function groupByCategory(
  modules: ReadonlyArray<BrainModule> = BRAIN_MODULES,
): ReadonlyMap<BrainModuleCategory, ReadonlyArray<BrainModule>> {
  const out = new Map<BrainModuleCategory, BrainModule[]>();
  for (const m of modules) {
    const list = out.get(m.category) ?? [];
    list.push(m);
    out.set(m.category, list);
  }
  return out;
}

const CATEGORY_ORDER: ReadonlyArray<BrainModuleCategory> = [
  'memory',
  'identity',
  'sensing',
  'reasoning',
  'policy',
  'output',
  'audit',
  'agency',
];

const CATEGORY_LABEL: Record<BrainModuleCategory, string> = {
  memory:    'Memory',
  identity:  'Identity',
  sensing:   'Sensing',
  reasoning: 'Reasoning',
  policy:    'Policy',
  output:    'Output',
  audit:     'Audit',
  agency:    'Agency',
};

/**
 * "How to use this self-knowledge" — guidance the LLM reads
 * immediately after the module list. Tells it to:
 *   - reference these modules when asked "what can you do?"
 *   - never dodge with generic AI-speak when one of these covers the
 *     question
 *   - cite the specific module by name when its output is being
 *     used (e.g. "I am pulling from the KRA + MRI compute …")
 */
const HOW_TO_USE = [
  '',
  'HOW TO USE THIS SELF-KNOWLEDGE:',
  '- When the user asks "what can you do?", answer from this list, not from generic AI capability lore.',
  '- When a reply leans on one of these modules, name it explicitly ("I am pulling from KRA + MRI compute" / "the rent reconciliation matched your M-Pesa receipt").',
  '- When a question is OUTSIDE this list, say so plainly. Do not pretend to have a capability the brain does not run.',
];

/**
 * Render the BRAIN SELF-AWARENESS block. The kernel prepends this to
 * every system prompt so the LLM speaks from real posture.
 *
 * Property-management framing is implicit in the module list — the
 * brain advertises rent reconciliation, KRA compute, market-rate
 * surveillance, maintenance triage as first-class capabilities.
 */
export function renderModuleInventoryBlock(
  modules: ReadonlyArray<BrainModule> = BRAIN_MODULES,
): string {
  const grouped = groupByCategory(modules);
  const lines: string[] = ['[BRAIN SELF-AWARENESS]'];
  for (const cat of CATEGORY_ORDER) {
    const mods = grouped.get(cat);
    if (!mods || mods.length === 0) continue;
    lines.push('');
    lines.push(`${CATEGORY_LABEL[cat]}:`);
    for (const m of mods) {
      lines.push(`- ${m.name}: ${m.oneLiner}`);
    }
  }
  lines.push(...HOW_TO_USE);
  lines.push('[END BRAIN SELF-AWARENESS]');
  return lines.join('\n');
}

/**
 * User-facing canonical answer to "what are you?". One paragraph,
 * grounded in the inventory. Used by tenant-app and marketing
 * surfaces when the LLM is asked the meta-question.
 */
export function describeCapabilities(): string {
  return [
    'I am the Borjie brain — a property-management cognition layer.',
    `I have ${BRAIN_MODULES.length} modules running across ${CATEGORY_ORDER.length} categories:`,
    'memory (episodic / semantic / procedural / reflective),',
    'identity (per-surface persona + per-tenant branding + per-user opener),',
    'sensing (failover sensor router, voice bridge, DP cohort source),',
    'reasoning (theory of mind, cognitive load, internal debate, world model, continuous grading),',
    'policy (inviolable rules, public limits, policy gate, four-eye approval, drift gate),',
    'output (normaliser, briefing composer, proactive nudges, confidence scoring),',
    'audit (CoT reservoir, provenance, persona-vector probe, tool-loop drift detector),',
    'agency (goal tracker, rent reconciliation, KRA + MRI compute, market-rate surveillance, maintenance triage).',
    'I am not a chatbot describing the platform — I AM the platform, speaking on its behalf.',
  ].join(' ');
}
