/**
 * @borjie/executive-brief-engine — hypothesis-generator.
 *
 * Step 1 of the LLM stack. Given the sensor signals, generate 5-8
 * candidate {Gap, Opportunity, Risk} hypotheses. Each carries the
 * source signals' evidence refs so we can backtrack to citations.
 *
 * This is the "Haiku call" — cheap, fast, breadth-first. Stronger
 * models only see hypotheses that survive the verifier + judge cull.
 *
 * The package owns the prompt shape + the parser. The actual model
 * call is a port — the api-gateway composition wires the existing
 * Anthropic sensor / online judge.
 */

import { z } from 'zod';
import { HypothesisSchema, type Hypothesis } from './types.js';
import type { SensorSignal } from './sensors.js';

// ─────────────────────────────────────────────────────────────────────
// Port — Haiku-class LLM call.
//
// Implementation in `services/api-gateway/src/composition/` should wrap
// `packages/central-intelligence/src/kernel/sensors/anthropic-sensor.ts`
// with model="claude-3-5-haiku-20241022", temperature=0.4.
// ─────────────────────────────────────────────────────────────────────

export interface HaikuLlmPort {
  /** Returns the raw model JSON output as a string. */
  call(args: {
    readonly system: string;
    readonly user: string;
    readonly maxOutputTokens?: number;
  }): Promise<{ readonly text: string; readonly costMicros: number }>;
}

// ─────────────────────────────────────────────────────────────────────
// Prompt (versioned). Bumping this version invalidates cached briefs.
// ─────────────────────────────────────────────────────────────────────

export const HYPOTHESIS_PROMPT_VERSION = '2026-05-22.v1';

const SYSTEM_PROMPT = [
  'You are the analyst inside an executive brief engine for a property',
  'management SaaS. Given the sensor signals below, surface 5-8 candidate',
  'findings that an executive would want flagged.',
  '',
  'Output JSON with these constraints:',
  '  - kind ∈ {gap, opportunity, risk}',
  '  - title:   short, 6-12 words',
  '  - description: 1-3 plain-language sentences with concrete numbers',
  '  - severity: LOW | MEDIUM | HIGH | CRITICAL',
  '  - evidenceRefs: array of {kind: entity|audit_event|document, id, page?}',
  '    pulled from the signals that motivated this hypothesis. NEVER',
  '    invent ids — only use ids present in the signals.',
  '',
  'Bias toward concrete, citable observations. If you cannot back a',
  'claim with at least one evidenceRef from the input, DO NOT emit it.',
  '',
  'Return ONLY a JSON array; no prose.',
].join('\n');

const HypothesisArraySchema = z.array(HypothesisSchema);

// ─────────────────────────────────────────────────────────────────────
// generateHypotheses — public API.
// ─────────────────────────────────────────────────────────────────────

export interface GenerateArgs {
  readonly signals: ReadonlyArray<SensorSignal>;
  readonly locale: string;
  readonly llm: HaikuLlmPort;
  /** Truncate signals at this count to keep prompt size bounded. */
  readonly maxSignals?: number;
}

export interface GenerateResult {
  readonly hypotheses: ReadonlyArray<Hypothesis>;
  readonly costMicros: number;
  readonly degraded: boolean;
  readonly promptVersion: string;
}

export async function generateHypotheses(args: GenerateArgs): Promise<GenerateResult> {
  const maxSignals = args.maxSignals ?? 40;
  const signalsToUse = args.signals.slice(0, maxSignals);

  if (signalsToUse.length === 0) {
    return {
      hypotheses: [],
      costMicros: 0,
      degraded: true,
      promptVersion: HYPOTHESIS_PROMPT_VERSION,
    };
  }

  const userPayload = {
    locale: args.locale,
    signal_count: signalsToUse.length,
    signals: signalsToUse.map((s) => ({
      sensor: s.sensor,
      metric: s.metric,
      value: s.value,
      unit: s.unit,
      delta: s.delta,
      baseline: s.baseline,
      timestamp: s.timestamp.toISOString(),
      note: s.note,
      evidence_refs: s.evidenceRefs,
    })),
  };

  let raw: { text: string; costMicros: number };
  try {
    raw = await args.llm.call({
      system: SYSTEM_PROMPT,
      user: JSON.stringify(userPayload),
      maxOutputTokens: 2048,
    });
  } catch {
    return {
      hypotheses: [],
      costMicros: 0,
      degraded: true,
      promptVersion: HYPOTHESIS_PROMPT_VERSION,
    };
  }

  const parsed = parseHypothesisJson(raw.text);
  return {
    hypotheses: parsed,
    costMicros: raw.costMicros,
    degraded: false,
    promptVersion: HYPOTHESIS_PROMPT_VERSION,
  };
}

// ─────────────────────────────────────────────────────────────────────
// parseHypothesisJson — defensive parser.
//
// The LLM sometimes wraps the JSON in ```json fences or adds trailing
// prose despite the prompt instructions. We strip + then `.safeParse`
// so malformed output never breaks the engine.
// ─────────────────────────────────────────────────────────────────────

export function parseHypothesisJson(raw: string): ReadonlyArray<Hypothesis> {
  const cleaned = stripCodeFences(raw).trim();
  // Try to find the first '[' — if there's leading prose.
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const candidate = cleaned.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return [];
  }

  const result = HypothesisArraySchema.safeParse(parsed);
  if (!result.success) {
    // Per-element fallback: try to recover the valid entries.
    if (Array.isArray(parsed)) {
      const recovered: Hypothesis[] = [];
      for (const item of parsed) {
        const p = HypothesisSchema.safeParse(item);
        if (p.success) recovered.push(p.data);
      }
      return recovered;
    }
    return [];
  }
  return result.data;
}

function stripCodeFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}
