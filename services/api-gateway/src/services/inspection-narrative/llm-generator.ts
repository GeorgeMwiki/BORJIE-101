/**
 * R15 — Inspection-narrative LLM generator (G-FIX-2).
 *
 * Wraps the deterministic heuristic narrator from
 * `services/api-gateway/src/services/inspection-narrative/generator.ts`
 * with a real Anthropic LLM call. The LLM is asked to produce a
 * bilingual Swahili+English Markdown narrative grounded in the
 * inspection checklist and evidence IDs supplied by the caller —
 * matching the same `GeneratedNarrative` shape the heuristic returns.
 *
 * Caching, evidence-required wrapper, and graceful-degradation
 * fallback all live in `services/api-gateway/src/services/brain/llm-call.ts`.
 *
 * Per CLAUDE.md:
 *   - Bilingual sw/en is required for user-visible content.
 *   - Evidence chain MUST be non-empty (Auditor Agent rejects empty).
 *   - Pino logger only.
 */

import type { Logger } from 'pino';
import { z } from 'zod';

import {
  callBrainLlmJson,
  withLlmOrHeuristic,
  type BrainLlmClient,
} from '../brain/llm-call';
import {
  defaultGenerateNarrative,
  type GenerateNarrative,
  type GeneratedNarrative,
  type InspectionInputForLlm,
} from './generator';

const NARRATIVE_SCHEMA = z.object({
  draftMdSw: z.string().min(40),
  draftMdEn: z.string().min(40),
  // Evidence-required enforcement is handled by the `hasEvidence`
  // callback in withLlmOrHeuristic so we can route to the heuristic
  // (rather than throwing) when the LLM omits evidence.
  evidenceIds: z.array(z.string()).default([]),
});

const PROMPT_VERSION = 'r15-narrator-v1';

const SYSTEM_PROMPT = [
  'You are Borjie, a mining-estate inspection report writer for Tanzanian',
  '(and pan-African) artisanal-to-mid-tier mining operators. Produce a',
  'BILINGUAL Markdown narrative for the inspection supplied by the user.',
  '',
  'Hard rules (do not break):',
  '- Output JSON ONLY matching:',
  '  { "draftMdSw": <Swahili Markdown>, "draftMdEn": <English Markdown>, "evidenceIds": [<string>, ...] }',
  '- Swahili (sw) is the default language. Both fields are required.',
  '- The narrative MUST cite every evidence_id supplied in a final "## Ushahidi" / "## Evidence" section.',
  '- The evidenceIds array MUST mirror the inspection evidence list verbatim. If the caller supplied zero',
  '  evidence IDs you MUST still return an empty array AND include a "(no evidence)" placeholder line so',
  '  the downstream Auditor Agent can flag the gap — but in your JSON `evidenceIds` field, only include',
  '  IDs that were actually supplied.',
  '- Use neutral, factual prose. No marketing copy. No emojis.',
  '- Front-matter as YAML at the top of BOTH narratives (--- delimited) with: inspection_id, inspection_kind,',
  '  observed_at, evidence_count, prompt_version.',
  '- Group findings as: Summary / Findings / Evidence.',
  '- Keep each narrative under ~3500 characters.',
].join('\n');

export interface LlmGeneratorOptions {
  readonly client: BrainLlmClient;
  readonly logger?: Logger | undefined;
  readonly heuristic?: GenerateNarrative | undefined;
  readonly model?: string | undefined;
}

/**
 * Build a `GenerateNarrative` function that calls Anthropic with
 * prompt caching and falls back to the deterministic heuristic on
 * failure / missing evidence.
 */
export function createLlmInspectionNarrator(
  options: LlmGeneratorOptions,
): GenerateNarrative {
  const heuristic = options.heuristic ?? defaultGenerateNarrative;

  return async (input: InspectionInputForLlm): Promise<GeneratedNarrative> => {
    return withLlmOrHeuristic<GeneratedNarrative>({
      pathName: 'inspection-narrative-r15',
      logger: options.logger,
      heuristic: () => heuristic(input),
      hasEvidence: (out) => {
        // If the original input had evidence IDs, the LLM output must
        // also have them so the Auditor Agent can chain back to source.
        if (input.evidenceIds.length === 0) return true;
        return out.draftMdSw.includes(input.evidenceIds[0] ?? '')
          || out.draftMdEn.includes(input.evidenceIds[0] ?? '');
      },
      llmAttempt: async () => {
        const result = await callBrainLlmJson({
          client: options.client,
          ...(options.model !== undefined ? { model: options.model } : {}),
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(input),
          schema: NARRATIVE_SCHEMA,
          maxTokens: 3500,
          temperature: 0.3,
          ...(options.logger !== undefined ? { logger: options.logger } : {}),
        });
        return {
          draftMdSw: result.data.draftMdSw,
          draftMdEn: result.data.draftMdEn,
          llmProvider: 'anthropic',
          llmModel: result.model,
          promptVersion: PROMPT_VERSION,
          // Anthropic Messages API charges ≈ $3 per million input
          // tokens for Sonnet 4.6 — heuristic rough USD estimate so
          // the cost column stays meaningful in the audit log.
          costUsd: estimateCostUsd(
            result.promptTokens,
            result.completionTokens,
          ),
        };
      },
    });
  };
}

function buildUserPrompt(input: InspectionInputForLlm): string {
  const checklist = input.checklist
    .map(
      (c) =>
        `- ${c.code} | ${c.status.toUpperCase()} | ${c.label}${
          c.note ? ` — note: ${c.note}` : ''
        }`,
    )
    .join('\n');
  return JSON.stringify(
    {
      inspectionId: input.inspectionId,
      inspectionKind: input.inspectionKind,
      siteName: input.siteName ?? null,
      assetName: input.assetName ?? null,
      supervisorName: input.supervisorName ?? null,
      shiftKind: input.shiftKind ?? null,
      observedAtIso: input.observedAt.toISOString(),
      notes: input.notes ?? null,
      evidenceIds: input.evidenceIds,
      checklistMarkdown: checklist,
    },
    null,
    2,
  );
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  // Sonnet 4.6 list pricing: $3/MTok input, $15/MTok output (1 USD ≈
  // 2500 TZS). Caller stores this on the persisted narrative row;
  // it's an estimate, not a billing source of truth.
  const inUsd = (inputTokens / 1_000_000) * 3;
  const outUsd = (outputTokens / 1_000_000) * 15;
  return Math.round((inUsd + outUsd) * 1_000_000) / 1_000_000;
}
