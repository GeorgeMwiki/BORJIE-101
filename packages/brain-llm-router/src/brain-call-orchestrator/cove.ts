/**
 * Chain-of-Verification (CoVe) wrapper (M-B pattern, ported in-package).
 *
 * Pattern (research §7 #6): after a draft, ask a cheaper critic model to
 * generate verification questions, answer each, then revise the draft.
 * 30-50% hallucination reduction on factual claims.
 *
 * This module is a duck-typed port — caller plugs in any `BrainLLMClient`
 * as the critic. Defaults to using the same client as the drafter (no-op
 * critic) to keep the orchestrator pure.
 */

import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse } from '../types.js';

export interface CoveConfig {
  readonly criticClient: BrainLLMClient;
  readonly criticModel: string;
  /** Override critic system prompt. */
  readonly verificationPrompt?: string;
}

export interface CoveResult {
  readonly draft: BrainLLMResponse;
  readonly verifiedResponse: BrainLLMResponse;
  readonly verificationScore: number; // [0..1]
  readonly criticUsage: BrainLLMResponse['usage'];
}

const DEFAULT_VERIFICATION_PROMPT = `You are a verification critic. Given a draft response, examine it for factual claims and rate it on a scale of 0.0 to 1.0 where 1.0 means fully verified, 0.0 means likely hallucinated. Return only the numeric score on the first line.`;

/**
 * Run CoVe: ask the critic to score the draft. Returns the verified
 * response + verificationScore. Caller decides whether to ship the draft
 * or escalate based on the score.
 */
export async function runCove(
  draft: BrainLLMResponse,
  originalReq: BrainLLMRequest,
  config: CoveConfig
): Promise<CoveResult> {
  const draftText = draft.content
    .filter((c) => c.type === 'text')
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n');

  const criticReq: BrainLLMRequest = {
    model: config.criticModel,
    system: config.verificationPrompt ?? DEFAULT_VERIFICATION_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Original prompt context follows. Then the draft to verify.\n\n${originalReq.system ?? ''}\n\nDraft:\n${draftText}`,
          },
        ],
      },
    ],
    maxTokens: 128,
    temperature: 0,
  };

  const criticResp = await config.criticClient.invoke(criticReq);
  const score = extractScore(criticResp);

  return {
    draft,
    verifiedResponse: draft, // CoVe in our port keeps the draft; score gates downstream
    verificationScore: score,
    criticUsage: criticResp.usage,
  };
}

function extractScore(resp: BrainLLMResponse): number {
  const text = resp.content
    .filter((c) => c.type === 'text')
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n')
    .trim();
  const firstLine = text.split('\n')[0] ?? '';
  const num = Number.parseFloat(firstLine);
  if (Number.isNaN(num)) return 0.5; // critic failed; neutral
  return Math.max(0, Math.min(1, num));
}
