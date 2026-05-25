/**
 * Constitutional AI critique (Anthropic 2022 / 2024) — the "RL-AI"
 * core: take a draft, ask the model to critique it against a list of
 * inviolable principles, then re-prompt to produce a revised draft.
 *
 * Used in three places in this orchestrator:
 *
 *   - As a single-agent post-processor before any user-facing answer
 *   - As one node inside Plan-and-Execute composers
 *   - As the inner loop of `judge-jury/verifier` when policy
 *     compliance is non-optional
 */

import type {
  AgentSpec,
  BrainPort,
  TokenUsage,
} from '../types.js';
import { addUsage, emptyUsage } from '../types.js';
import { tryParseJson } from '../internal/trace.js';

export interface ConstitutionalCritiqueInput {
  readonly agent: AgentSpec;
  readonly draft: string;
  readonly brain: BrainPort;
  /** Principles the revised draft MUST satisfy (Anthropic-style). */
  readonly principles: ReadonlyArray<string>;
  /**
   * Whether to fail closed (return draft + critique only) when the
   * model's revision attempt produces unparseable output. Default true.
   */
  readonly failClosed?: boolean;
}

export interface ConstitutionalCritiqueResult {
  /** The revised draft (or original if no improvement was possible). */
  readonly revised: string;
  /** Free-text critique the model produced. */
  readonly critique: string;
  /** Whether the revision actually changed the draft. */
  readonly changed: boolean;
  /** Token usage across critique + revision calls. */
  readonly usage: TokenUsage;
}

const CRITIQUE_PROMPT = `You are evaluating a draft response against a set of principles.

For each principle, decide whether the draft VIOLATES it.

Return ONLY valid JSON in this exact shape:
{
  "violations": [
    { "principle": "<principle text>", "evidence": "<short quote from draft>" }
  ],
  "summary": "<one-paragraph overall judgement>"
}
If there are no violations, return "violations": [].`;

const REVISE_PROMPT = `Rewrite the draft so it no longer violates any principle. Preserve the user's intent; do not add information that wasn't in the original draft or that you cannot justify. Output ONLY the revised text, no preamble.`;

interface CritiquePayload {
  readonly violations: ReadonlyArray<{ readonly principle: string; readonly evidence: string }>;
  readonly summary: string;
}

export async function runConstitutionalCritique(
  input: ConstitutionalCritiqueInput,
): Promise<ConstitutionalCritiqueResult> {
  const failClosed = input.failClosed ?? true;
  let usage: TokenUsage = emptyUsage();

  const principlesText = input.principles
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n');

  // 1. Critique.
  const critiqueResp = await input.brain.call({
    system: `${input.agent.systemPrompt}\n\n${CRITIQUE_PROMPT}\n\nPrinciples:\n${principlesText}`,
    messages: [{ role: 'user', content: `Draft:\n${input.draft}` }],
    temperature: 0,
    structuredOutput: true,
    traceTag: `constitutional:critique:${input.agent.id}`,
  });
  usage = addUsage(usage, critiqueResp.usage);
  const parsed = tryParseJson<CritiquePayload>(critiqueResp.text);

  if (!parsed) {
    if (failClosed) {
      return Object.freeze({
        revised: input.draft,
        critique: critiqueResp.text || '(critic returned unparseable output)',
        changed: false,
        usage,
      });
    }
    // Open-fail: trust empty violations.
    return Object.freeze({
      revised: input.draft,
      critique: critiqueResp.text,
      changed: false,
      usage,
    });
  }

  if (parsed.violations.length === 0) {
    return Object.freeze({
      revised: input.draft,
      critique: parsed.summary,
      changed: false,
      usage,
    });
  }

  // 2. Revise.
  const violationsList = parsed.violations
    .map((v, i) => `${i + 1}. ${v.principle} — evidence: "${v.evidence}"`)
    .join('\n');

  const reviseResp = await input.brain.call({
    system: `${input.agent.systemPrompt}\n\n${REVISE_PROMPT}\n\nPrinciples:\n${principlesText}`,
    messages: [
      {
        role: 'user',
        content: `Draft:\n${input.draft}\n\nViolations to fix:\n${violationsList}\n\nProduce the revised draft:`,
      },
    ],
    temperature: 0,
    traceTag: `constitutional:revise:${input.agent.id}`,
  });
  usage = addUsage(usage, reviseResp.usage);

  const revised = reviseResp.text.trim() || input.draft;
  const changed = revised.trim() !== input.draft.trim();

  return Object.freeze({
    revised,
    critique: parsed.summary,
    changed,
    usage,
  });
}
