/**
 * cross-provider-auditor/auditor — async second-opinion auditor.
 *
 * Ported from LITFIN `cross-provider-auditor.ts:auditProviderPair`.
 *
 * Flow (runs AFTER the user already has provider A's reply — a reliability net,
 * not a runtime gate, so it never slows chat):
 *   1. Decide via `shouldSampleForAudit` (5% baseline, 100% numeric/regulatory).
 *   2. Re-route the same prompt to a SECOND provider via an injected port.
 *   3. Extract + compare the primary numeric claim from both.
 *   4. If numeric divergence > tolerance (5% default), emit an audit event via
 *      the injected sink.
 *
 * All side-effecting collaborators are injected ports (second-opinion provider,
 * audit sink, RNG) — leaf logic imports no client, DB, or `fetch`.
 */

import { fnv1a } from '../eval-drift-logger/event.js';
import { compareClaims, extractPrimaryClaim, type ClaimComparison } from './claim-extract.js';
import { shouldSampleForAudit } from './sampling.js';

/** Default fractional numeric divergence tolerance (5%). */
export const NUMERIC_TOLERANCE = 0.05;

/** A model response to audit. `provider` is a free label (e.g. 'anthropic'). */
export interface AuditableResponse {
  readonly provider: string;
  readonly text: string;
}

/** Port: re-run the same prompt against a different provider. */
export type SecondOpinionPort = (args: {
  readonly prompt: string;
  readonly intent: string;
}) => Promise<AuditableResponse>;

export interface ProviderAuditEvent {
  readonly promptHash: string;
  readonly promptExcerpt: string;
  readonly intent: string;
  readonly providerA: string;
  readonly providerB: string;
  readonly claimA: string;
  readonly claimB: string;
  readonly numericA: number | null;
  readonly numericB: number | null;
  readonly agreement: number;
  readonly diverged: boolean;
  readonly kind: ClaimComparison['kind'];
  readonly at: string;
}

export type ProviderAuditSink = (event: ProviderAuditEvent) => void | Promise<void>;

const NOOP_SINK: ProviderAuditSink = () => {};

export interface AuditorConfig {
  readonly secondOpinion: SecondOpinionPort;
  /** Where divergence events go. Default no-op. */
  readonly sink?: ProviderAuditSink;
  /** Fractional numeric tolerance. Default 0.05. */
  readonly tolerance?: number;
  /** Map unknown intents to the 5% baseline. Default false. */
  readonly treatUnknownAsDefault?: boolean;
  /** Injectable RNG. Default Math.random. */
  readonly random?: () => number;
}

export interface AuditOutcome {
  /** False when sampling skipped the audit. */
  readonly audited: boolean;
  readonly diverged: boolean;
  readonly agreement: number;
  readonly kind: ClaimComparison['kind'];
  /** The emitted event, when audited. */
  readonly event: ProviderAuditEvent | null;
}

const SKIPPED: AuditOutcome = Object.freeze({
  audited: false,
  diverged: false,
  agreement: 1,
  kind: null,
  event: null,
});

/** Excerpt for the audit row (no raw PII beyond the prompt head). */
function excerpt(prompt: string): string {
  return prompt.slice(0, 200);
}

/**
 * Audit one primary response. Decides sampling, fetches a second opinion only
 * when sampled, compares claims, and emits a divergence event via the sink.
 *
 * Never throws — a failing second-opinion provider or sink is swallowed (this
 * is an after-the-fact reliability net, not part of the user's response path).
 */
export async function auditResponse(
  args: {
    readonly prompt: string;
    readonly intent: string;
    readonly primary: AuditableResponse;
  },
  config: AuditorConfig,
): Promise<AuditOutcome> {
  const tolerance = config.tolerance ?? NUMERIC_TOLERANCE;
  const sink = config.sink ?? NOOP_SINK;

  const claimA = extractPrimaryClaim(args.primary.text);
  // Force the audit when the primary response actually carries a numeric claim
  // (mirrors LITFIN's numeric fast-path); otherwise fall to intent sampling.
  const forceNumeric = claimA?.numeric !== null && claimA?.numeric !== undefined;

  const sampled = shouldSampleForAudit(args.intent, {
    forceNumeric,
    treatUnknownAsDefault: config.treatUnknownAsDefault ?? false,
    ...(config.random ? { random: config.random } : {}),
  });
  if (!sampled) return SKIPPED;

  let second: AuditableResponse;
  try {
    second = await config.secondOpinion({ prompt: args.prompt, intent: args.intent });
  } catch {
    // Second provider unavailable — cannot audit; skip silently.
    return SKIPPED;
  }

  const claimB = extractPrimaryClaim(second.text);
  const comparison = compareClaims(claimA, claimB, tolerance);

  const event: ProviderAuditEvent = {
    promptHash: fnv1a(args.prompt.replace(/\s+/g, ' ').trim().toLowerCase()),
    promptExcerpt: excerpt(args.prompt),
    intent: args.intent,
    providerA: args.primary.provider,
    providerB: second.provider,
    claimA: claimA?.text ?? '',
    claimB: claimB?.text ?? '',
    numericA: claimA?.numeric ?? null,
    numericB: claimB?.numeric ?? null,
    agreement: comparison.agreement,
    diverged: comparison.diverged,
    kind: comparison.kind,
    at: new Date().toISOString(),
  };

  // Only emit on divergence — agreement is the common case and need not be
  // logged. (Flip to always-emit at the sink if a full audit trail is wanted.)
  if (comparison.diverged) {
    try {
      await sink(event);
    } catch {
      // Sink failure must not propagate into the (already-served) request.
    }
  }

  return {
    audited: true,
    diverged: comparison.diverged,
    agreement: comparison.agreement,
    kind: comparison.kind,
    event,
  };
}
