/**
 * Verifier — calls the multi-LLM synthesizer with a verifier-shaped
 * prompt that takes the original goal + the records from the executed
 * plan and asks whether the goal was achieved. Returns a structured
 * `VerificationResult` with confidence + deltas.
 */

import type {
  ExecutionRecord,
  MultiLlmRequest,
  MultiLlmSynthesizer,
  Plan,
  VerificationResult,
} from './types.js';

const VERIFIER_SYSTEM = `You are the VERIFIER for a property-management AI agent.
Given a goal + the records produced by executing a plan, decide whether
the goal was achieved. Output a JSON object (no prose):

{
  "goalAchieved": boolean,
  "confidence": number in [0,1],
  "evidence": [<EvidenceCitation>],
  "deltas": [{ "description": "string", "criterion": "string?" }],
  "summary": "string (one short paragraph)"
}

Rules:
- Be skeptical. If a step's output contradicts the goal, surface it.
- Confidence < 0.7 triggers a re-verify pass.
- An empty deltas array means goal achieved beyond doubt.`;

export async function verifyGoal(
  plan: Plan,
  records: ReadonlyArray<ExecutionRecord>,
  synthesizer: MultiLlmSynthesizer,
): Promise<VerificationResult> {
  const summary = records
    .map((r) =>
      `[${r.status}] ${r.toolName} (step=${r.stepId}) — ${r.error ?? JSON.stringify(r.output).slice(0, 240)}`,
    )
    .join('\n');

  const req: MultiLlmRequest = {
    purpose: 'verifier',
    system: VERIFIER_SYSTEM,
    userMessage: `Goal: ${plan.goal}\n\nExecution records:\n${summary}`,
    minAgreement: 2,
  };
  const resp = await synthesizer.synthesize(req);

  if (!resp.converged) {
    // Treat no-consensus as low-confidence "not achieved" with empty evidence
    // so the orchestrator triggers a re-verify or re-plan.
    return Object.freeze({
      goalAchieved: false,
      confidence: 0,
      evidence: [],
      deltas: [
        Object.freeze({
          description: `verifier did not reach consensus (${resp.modelsAgreed}/${resp.modelsQueried})`,
        }),
      ],
      summary: 'No verifier consensus — abstaining.',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.text);
  } catch {
    return Object.freeze({
      goalAchieved: false,
      confidence: 0,
      evidence: [],
      deltas: [Object.freeze({ description: 'verifier returned non-JSON' })],
      summary: 'Verifier response unparseable.',
    });
  }

  const root = (parsed as Record<string, unknown>) ?? {};
  const confidence = typeof root.confidence === 'number' ? Math.max(0, Math.min(1, root.confidence)) : 0;
  return Object.freeze({
    goalAchieved: root.goalAchieved === true,
    confidence,
    evidence: Array.isArray(root.evidence) ? (root.evidence as VerificationResult['evidence']) : [],
    deltas: Array.isArray(root.deltas) ? (root.deltas as VerificationResult['deltas']) : [],
    summary: typeof root.summary === 'string' ? root.summary : '',
  });
}
