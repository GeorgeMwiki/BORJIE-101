/**
 * Reflection — Wave 28.
 *
 * Given an OutcomeEvent, compose a short `{ what, why, outcome, lesson }`
 * reflection and write it to semantic memory under the key
 * `reflection/{tenantId}/{actionId}`. Uses the ClassifyLLMPort contract
 * so tests can stub with a deterministic mock.
 *
 * When no LLM is available we fall back to a deterministic rule-based
 * reflection; the loop must never break just because the provider is
 * down.
 */

import type { ClassifyLLMPort } from '../ai-native/shared.js';
import { safeJsonParse } from '../ai-native/shared.js';
import type { SemanticMemory } from '../memory/semantic-memory.js';
import type { OutcomeEvent, Reflection } from './types.js';

export interface WriteReflectionDeps {
  readonly memory: SemanticMemory;
  readonly llm?: ClassifyLLMPort;
  readonly now?: () => Date;
}

const SYSTEM_PROMPT = `You are reflecting on an autonomous action the property-management
AI took. Given the action context + outcome, return ONLY JSON matching:
{
  "what": string,     // one-sentence summary of what was done
  "why": string,      // one-sentence rationale recap
  "outcome": string,  // one-sentence outcome description
  "lesson": string    // one-sentence lesson to carry forward
}
Keep each field under 200 characters. No preamble, no trailing prose.`;

function deterministicReflection(outcome: OutcomeEvent): Reflection {
  const what = `${outcome.actionType} (${outcome.decision}) executed in ${outcome.domain}`;
  const why = outcome.rationale || `confidence ${outcome.confidence.toFixed(2)}`;
  const outcomeLine = outcome.observedConsequences
    ? `${outcome.outcome}: ${outcome.observedConsequences}`
    : outcome.outcome;
  const lesson = deriveLesson(outcome);
  return {
    actionId: outcome.actionId,
    tenantId: outcome.tenantId,
    what,
    why,
    outcome: outcomeLine,
    lesson,
  };
}

function deriveLesson(outcome: OutcomeEvent): string {
  switch (outcome.outcome) {
    case 'success':
      return `Continue allowing ${outcome.actionType} when confidence >= ${outcome.confidence.toFixed(2)}.`;
    case 'failure':
      return `Tighten ${outcome.actionType}: similar context produced failure at confidence ${outcome.confidence.toFixed(2)}.`;
    case 'reverted':
      return `Escalate ${outcome.actionType} for human review in similar contexts; this one was reverted.`;
    default:
      return `Awaiting outcome signal for ${outcome.actionType}; revisit once it resolves.`;
  }
}

export async function writeReflection(
  outcome: OutcomeEvent,
  deps: WriteReflectionDeps,
): Promise<Reflection> {
  let reflection: Reflection;

  if (!deps.llm) {
    reflection = deterministicReflection(outcome);
  } else {
    try {
      const userPrompt = JSON.stringify({
        actionId: outcome.actionId,
        domain: outcome.domain,
        actionType: outcome.actionType,
        decision: outcome.decision,
        rationale: outcome.rationale,
        confidence: outcome.confidence,
        outcome: outcome.outcome,
        feedbackScore: outcome.feedbackScore,
        observedConsequences: outcome.observedConsequences,
        context: outcome.context,
      });
      const res = await deps.llm.classify({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
      });
      const parsed = safeJsonParse<{
        what?: string;
        why?: string;
        outcome?: string;
        lesson?: string;
      }>(res.raw);
      if (parsed && parsed.what && parsed.lesson) {
        reflection = {
          actionId: outcome.actionId,
          tenantId: outcome.tenantId,
          what: String(parsed.what).slice(0, 500),
          why: String(parsed.why ?? outcome.rationale).slice(0, 500),
          outcome: String(parsed.outcome ?? outcome.outcome).slice(0, 500),
          lesson: String(parsed.lesson).slice(0, 500),
        };
      } else {
        reflection = deterministicReflection(outcome);
      }
    } catch {
      reflection = deterministicReflection(outcome);
    }
  }

  await deps.memory.remember({
    tenantId: outcome.tenantId,
    memoryType: 'learning',
    content: `[reflection] ${reflection.what} — Lesson: ${reflection.lesson}`,
    metadata: {
      kind: 'reflection',
      actionId: outcome.actionId,
      domain: outcome.domain,
      actionType: outcome.actionType,
      memoryKey: `reflection/${outcome.tenantId}/${outcome.actionId}`,
      what: reflection.what,
      why: reflection.why,
      outcome: reflection.outcome,
      lesson: reflection.lesson,
    },
    confidence: 0.7,
  });

  return reflection;
}
