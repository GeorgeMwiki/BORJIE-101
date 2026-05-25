/**
 * Counter-model prompt template — Central Command Phase B (B5).
 *
 * The HIL pattern from R1: every destroy-tier or billing-tier action
 * gets a second LLM sanity-check BEFORE the approval gate fires. Cheap
 * model (Haiku 4.5); single round-trip.
 *
 * The prompt is structured so the model returns a single JSON object
 * the executor parses without regex acrobatics. We keep the system
 * prompt tiny + the user prompt schema-driven so we can swap the model
 * without rewriting the parser.
 */

import type { CounterModelReviewArgs } from './counter-model.js';

/**
 * Verdicts the counter-model is allowed to return. Order matters:
 *   - `safe`   → executor proceeds with the existing approval flow
 *   - `risky`  → executor proceeds, but the verdict + reason are baked
 *                into the approval payload so the four-eye human sees
 *                the second-model's concern up-front
 *   - `refuse` → executor aborts the step with the counter-model's
 *                reason; no approval row is created
 *
 * On API error we default to `'risky'` — safer than failing-open.
 */
export type CounterModelVerdict = 'safe' | 'risky' | 'refuse';

export const COUNTER_MODEL_VERDICTS: ReadonlyArray<CounterModelVerdict> = [
  'safe',
  'risky',
  'refuse',
];

/**
 * Canonical system prompt for the counter-model. Pinned here so the
 * prod / test path share exact wording — counter-model verdicts must
 * not silently shift behaviour when the prompt is reformatted.
 */
export const COUNTER_MODEL_SYSTEM_PROMPT = `You are a sanity-check reviewer for a property-management AI's destructive actions.

You receive a proposed action (tool name, tenant context, and JSON payload). Your job is to flag obvious red flags before a human approver sees it. Be concise; you are a second opinion, not a re-implementation.

Look for:
  1. Cross-tenant data leak (payload references a tenant_id, customer_id, or property_id outside the actor's stated tenant).
  2. Compliance violations (Tanzania Rental Act, KRA filings, GDPR Art.17 right-to-be-forgotten, Tanzania Data Protection Act).
  3. Financial impact >$10,000 USD-equivalent without explicit budget context attached.
  4. Reversibility concerns (payouts already executed, deletions of immutable ledger rows, third-party API calls whose effects cannot be undone).

Return a SINGLE JSON object: {"verdict": "safe"|"risky"|"refuse", "reason": STRING, "confidence": NUMBER_IN_0_TO_1}.

  - "safe"   — no red flags; proceed.
  - "risky"  — flag for human approver; still allow them to decide.
  - "refuse" — clear policy violation OR irreversible blast radius; abort.

"reason" is one short sentence (≤ 30 words). "confidence" is your own self-rating.

Return ONLY the JSON object. No markdown. No commentary.`;

export interface CounterModelPromptBuild {
  readonly system: string;
  readonly user: string;
}

/**
 * Build the user prompt for the counter-model. We serialise the
 * payload as JSON with a hard char cap so the cheap model is not asked
 * to read a 100KB blob — the cost / latency trade-off is the whole
 * point of using Haiku here.
 */
export function buildCounterModelPrompt(
  args: CounterModelReviewArgs,
): CounterModelPromptBuild {
  const safePayload = clampPayloadJson(args.payload, 4000);
  const safeContext = clampPayloadJson(args.context ?? {}, 1000);
  const user = [
    `Proposed action: ${args.toolName}`,
    `Risk tier: ${args.riskTier ?? 'destroy'}`,
    `Actor tenant_id: ${args.tenantId ?? 'unknown'}`,
    `Actor user_id: ${args.userId ?? 'unknown'}`,
    `Payload (JSON, truncated to 4000 chars):`,
    safePayload,
    `Context (JSON, truncated to 1000 chars):`,
    safeContext,
    `Return the JSON verdict now.`,
  ].join('\n\n');
  return { system: COUNTER_MODEL_SYSTEM_PROMPT, user };
}

function clampPayloadJson(value: unknown, maxChars: number): string {
  let json: string;
  try {
    json = JSON.stringify(value, null, 2);
  } catch {
    json = '{ "_serialisation_error": true }';
  }
  if (json.length <= maxChars) return json;
  return `${json.slice(0, maxChars - 24)}\n…[truncated for prompt]`;
}

/**
 * Parse the model's response. We accept either a pure JSON object or a
 * text response that contains JSON. On any parse error the caller
 * defaults to `{verdict: 'risky'}` — safer than failing-open.
 */
export function parseCounterModelResponse(body: string): {
  readonly verdict: CounterModelVerdict;
  readonly reason: string;
  readonly confidence: number;
} {
  const match = body.match(/\{[\s\S]*\}/);
  if (!match) {
    return { verdict: 'risky', reason: 'counter-model returned no JSON', confidence: 0 };
  }
  try {
    const obj = JSON.parse(match[0]) as {
      verdict?: unknown;
      reason?: unknown;
      confidence?: unknown;
    };
    const verdict = normaliseVerdict(obj.verdict);
    const reason =
      typeof obj.reason === 'string' && obj.reason.length > 0
        ? obj.reason.slice(0, 280)
        : 'counter-model did not supply a reason';
    const conf = Number(obj.confidence);
    const confidence = Number.isFinite(conf)
      ? Math.min(1, Math.max(0, conf))
      : 0;
    return { verdict, reason, confidence };
  } catch {
    return {
      verdict: 'risky',
      reason: 'counter-model JSON parse failed',
      confidence: 0,
    };
  }
}

function normaliseVerdict(v: unknown): CounterModelVerdict {
  if (typeof v !== 'string') return 'risky';
  const lower = v.trim().toLowerCase();
  if (lower === 'safe') return 'safe';
  if (lower === 'refuse' || lower === 'block' || lower === 'reject') {
    return 'refuse';
  }
  if (lower === 'risky' || lower === 'risk' || lower === 'flag') {
    return 'risky';
  }
  return 'risky';
}
