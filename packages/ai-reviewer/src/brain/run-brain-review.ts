/**
 * Run the brain port over a request that has cleared its policy's
 * pre-checks + red-lines. Returns a {@link ReviewDecision}.
 *
 * If the brain's structured output fails the {@link brainReviewSchema}
 * we degrade to `escalate` rather than throw — the consumer should
 * route to a human.
 */

import {
  brainReviewSchema,
  type BrainPort,
  type PolicyRule,
  type PolicyRequest,
  type ReviewDecision,
  type DecisionReason,
  type SuggestedFix,
} from '../types.js';

export const REVIEWER_SYSTEM_PROMPT =
  'You are a property-management workflow reviewer. ' +
  'Return STRICTLY structured JSON matching the schema: ' +
  '{verdict, confidence (0..1), reasons[], suggestedFixes[]}. ' +
  'Verdicts: approve | reject_with_changes | reject_final | escalate. ' +
  'Use "escalate" if you cannot reach a confident verdict in one pass.';

export interface RunBrainReviewArgs<TPayload> {
  readonly request: PolicyRequest<TPayload>;
  readonly policy: PolicyRule<TPayload>;
  readonly brain: BrainPort;
}

export async function runBrainReview<TPayload>(
  args: RunBrainReviewArgs<TPayload>,
): Promise<ReviewDecision> {
  const { request, policy, brain } = args;
  const decidedAt = new Date().toISOString();

  let raw: unknown;
  try {
    raw = await brain.respond({
      systemPrompt: REVIEWER_SYSTEM_PROMPT,
      question: policy.brainPrompt(request),
      context: { kind: request.kind, payload: request.payload },
    });
  } catch (error) {
    return {
      verdict: 'escalate',
      confidence: 0,
      reasons: [
        {
          code: 'brain.invocation_failed',
          message: `Brain port threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
          severity: 'critical',
        },
      ],
      suggestedFixes: [],
      ...(request.context.correlationId === undefined
        ? {}
        : { correlationId: request.context.correlationId }),
      decidedAt,
    };
  }

  const parsed = brainReviewSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      verdict: 'escalate',
      confidence: 0,
      reasons: [
        {
          code: 'brain.structured_output_invalid',
          message: `Brain output failed schema validation: ${parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
          severity: 'critical',
        },
      ],
      suggestedFixes: [],
      ...(request.context.correlationId === undefined
        ? {}
        : { correlationId: request.context.correlationId }),
      decidedAt,
    };
  }

  const reasons: DecisionReason[] = parsed.data.reasons.map((r) => ({
    code: r.code,
    message: r.message,
    severity: r.severity,
    ...(r.field === undefined ? {} : { field: r.field }),
  }));

  const suggestedFixes: SuggestedFix[] = parsed.data.suggestedFixes.map((f) => ({
    description: f.description,
    ...(f.patch === undefined ? {} : { patch: f.patch }),
  }));

  return {
    verdict: parsed.data.verdict,
    confidence: parsed.data.confidence,
    reasons,
    suggestedFixes,
    ...(request.context.correlationId === undefined
      ? {}
      : { correlationId: request.context.correlationId }),
    decidedAt,
  };
}
