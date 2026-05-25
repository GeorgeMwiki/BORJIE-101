/**
 * Piece L — Post-pipeline capture hook.
 *
 * Runs AFTER `BrainKernel.think()` returns its `BrainDecision`. Steps:
 *
 *   1. Extract raw entities from the user/assistant exchange (regex NER).
 *   2. Resolve each entity to a canonical id via the resolver port.
 *      Entities that fail resolution are DROPPED (no hallucinations).
 *   3. Classify intent (heuristic with optional LLM fallback).
 *   4. Compute capture_confidence = min(resolver, intent, persona_trust,
 *      tenant_trust).
 *   5. Insert the capture row (skipping duplicates by exchange_hash).
 *   6. Hash-chain the capture into ai_audit_chain.
 *   7. If confidence < router_threshold: emit a proactive nudge log
 *      entry (and return) — do NOT dispatch.
 *   8. Otherwise call `dispatchToTabs` (caller wires this when wanted).
 *
 * The hook is OFF the critical path: callers fire it async after
 * `think()` resolves so no user-reply latency is added. Refused or
 * softened decisions skip the hook entirely (inviolable rule).
 */

import { createHash, randomUUID } from 'crypto';
import { extractRawEntities } from './entity-extractor.js';
import {
  DEFAULT_TENANT_TRUST,
  PERSONA_TRUST_BY_TIER,
  ROUTER_THRESHOLD,
} from './matrix-defaults.js';
import type { AuditChainSink } from './audit-link.js';
import type { ConversationCaptureStore, TabEventLogStore } from './store.js';
import type {
  CanonicalResolver,
  CaptureInput,
  ClockFn,
  ConversationCapture,
  IntentClassifier,
  RandomIdFn,
  ResolvedEntity,
  TabEventLogEntry,
} from './types.js';

export interface CaptureDeps {
  readonly resolver: CanonicalResolver;
  readonly classifier: IntentClassifier;
  readonly captureStore: ConversationCaptureStore;
  readonly eventLog: TabEventLogStore;
  readonly auditSink: AuditChainSink;
  readonly clock?: ClockFn;
  readonly randomId?: RandomIdFn;
  /**
   * Optional override for the router threshold below which we emit a
   * proactive nudge instead of dispatching. Defaults to ROUTER_THRESHOLD
   * (0.55) from matrix-defaults. Test rigs set a deterministic value.
   */
  readonly routerThreshold?: number;
}

export interface CaptureResult {
  readonly capture: ConversationCapture;
  /** TRUE when capture_confidence ≥ router_threshold (dispatcher should run). */
  readonly shouldDispatch: boolean;
  /** TRUE when the exact same exchange was already captured (idempotency). */
  readonly deduplicated: boolean;
}

/**
 * Run the post-pipeline capture hook. Returns the inserted capture row
 * and a flag telling the caller whether the dispatcher should run.
 *
 * The function is safe to call from a `void capture(...)` site — it
 * never throws on resolver/classifier errors (they degrade to lower
 * confidence + dropped entities).
 */
export async function capture(
  input: CaptureInput,
  deps: CaptureDeps,
): Promise<CaptureResult> {
  // Refused decisions are NEVER captured. Caller is expected to filter
  // before invoking us, but we double-check defensively.
  if (input.decision_kind !== 'answer' && input.decision_kind !== 'softened') {
    throw new Error(
      `capture invariant violated: decision_kind=${input.decision_kind} (only 'answer' or 'softened' may be captured)`,
    );
  }

  const startedAtMs =
    (deps.clock ? deps.clock() : new Date()).getTime();
  const now = deps.clock ? deps.clock() : new Date();
  const newId = deps.randomId ?? randomUUID;
  const routerThreshold = deps.routerThreshold ?? ROUTER_THRESHOLD;

  // 1. Compute exchange hash for dedup.
  const exchange_hash = computeExchangeHash(
    input.user_text,
    input.assistant_text,
  );

  // 1a. Dedup short-circuit: if we've already captured this exchange,
  // return the existing row + signal `deduplicated`.
  const existing = await deps.captureStore.findByHash(
    input.tenant_id,
    exchange_hash,
  );
  if (existing) {
    return { capture: existing, shouldDispatch: false, deduplicated: true };
  }

  // 2. Extract raw entities from (user + assistant) text.
  const seedEntities = input.pre_extracted_entities ?? [];
  const fromRegex = extractRawEntities(
    `${input.user_text}\n${input.assistant_text}`,
  );
  const allRaw: ReadonlyArray<{
    readonly raw_type: string;
    readonly value: string;
    readonly confidence: number;
  }> = [
    ...seedEntities.map((e) => ({
      raw_type: e.type,
      value: e.value,
      confidence: e.confidence,
    })),
    ...fromRegex,
  ];

  // 3. Resolve each raw entity to a canonical id. DROP unresolved.
  const resolved: ResolvedEntity[] = [];
  for (const raw of allRaw) {
    try {
      const res = await deps.resolver({
        tenant_id: input.tenant_id,
        raw_type: raw.raw_type,
        raw_value: raw.value,
      });
      if (res) {
        // Multiply raw confidence by resolver confidence to capture both
        // extractor uncertainty AND resolver uncertainty in one number.
        const combined = Math.min(raw.confidence, res.confidence);
        resolved.push({
          type: res.type,
          canonical_id: res.canonical_id,
          raw_value: raw.value,
          confidence: combined,
          source: res.source,
        });
      }
      // Unresolved entities are dropped on the floor — the
      // hallucination-prevention invariant.
    } catch (_err) {
      // Resolver error: drop the entity rather than crash capture.
    }
  }

  // De-duplicate resolved entities by (type, canonical_id) — keep
  // highest confidence.
  const dedupedResolved: ResolvedEntity[] = [...dedupeByCanonical(resolved)];

  // 4. Classify intent.
  const intentResult = await deps.classifier({
    user_text: input.user_text,
    assistant_text: input.assistant_text,
    persona_id: input.persona.persona_id,
  });

  // 5. Compute capture_confidence = min(resolver, intent, persona, tenant).
  const resolverConfidence =
    dedupedResolved.length === 0
      ? 0 // No resolved entities → cannot dispatch.
      : Math.min(...dedupedResolved.map((e) => e.confidence));
  const personaTrust =
    PERSONA_TRUST_BY_TIER[input.persona.tier] ?? 0.5;
  const tenantTrust = input.tenant_trust ?? DEFAULT_TENANT_TRUST;
  const capture_confidence = Math.min(
    resolverConfidence,
    intentResult.confidence,
    personaTrust,
    tenantTrust,
  );

  const endMs = (deps.clock ? deps.clock() : new Date()).getTime();
  const latency_ms = Math.max(0, endMs - startedAtMs);

  // 6. Build the capture row.
  const captureRow: ConversationCapture = {
    id: `cap_${newId()}`,
    tenant_id: input.tenant_id,
    thread_id: input.thread_id ?? null,
    message_id: input.message_id ?? null,
    persona_id: input.persona.persona_id,
    user_id: input.user_id ?? null,
    user_text: input.user_text,
    assistant_text: input.assistant_text,
    decision_kind: input.decision_kind,
    entities: dedupedResolved,
    intent: intentResult.intent,
    intent_confidence: intentResult.confidence,
    capture_confidence,
    persona_trust: personaTrust,
    tenant_trust: tenantTrust,
    attributes: {
      jurisdiction: input.persona.jurisdiction ?? null,
      scope_predicate: input.persona.scope_predicate ?? null,
    },
    exchange_hash,
    latency_ms,
    created_at: now.toISOString(),
  };

  // 7. Persist + hash-chain (audit trail).
  await deps.captureStore.insert(captureRow);

  await deps.auditSink.append({
    tenant_id: input.tenant_id,
    turn_id: captureRow.id,
    session_id: input.thread_id ?? null,
    action: 'capture_emitted',
    payload: {
      capture_id: captureRow.id,
      persona_id: captureRow.persona_id,
      intent: captureRow.intent,
      intent_confidence: captureRow.intent_confidence,
      capture_confidence: captureRow.capture_confidence,
      entity_count: dedupedResolved.length,
      exchange_hash,
    },
  });

  // 7a. Append a tab_event_log row for the capture (kind = capture_emitted).
  const evt: TabEventLogEntry = {
    id: `evt_${newId()}`,
    tenant_id: input.tenant_id,
    capture_id: captureRow.id,
    proposal_id: null,
    module_template_id: null,
    persona_id: captureRow.persona_id,
    event_kind: 'capture_emitted',
    actor: 'system',
    transport: 'chat',
    snapshot: { capture_id: captureRow.id },
    notes: null,
    sequence: 0,
    created_at: now.toISOString(),
  };
  await deps.eventLog.append(evt);

  // 8. Decide whether to dispatch.
  const shouldDispatch =
    capture_confidence >= routerThreshold && dedupedResolved.length > 0;

  // 8a. Below threshold → emit a proactive-nudge event for the UI to surface.
  if (!shouldDispatch) {
    const nudge: TabEventLogEntry = {
      id: `evt_${newId()}`,
      tenant_id: input.tenant_id,
      capture_id: captureRow.id,
      proposal_id: null,
      module_template_id: null,
      persona_id: captureRow.persona_id,
      event_kind: 'proactive_nudge',
      actor: 'system',
      transport: 'chat',
      snapshot: {
        capture_id: captureRow.id,
        reason:
          dedupedResolved.length === 0
            ? 'no_resolved_entities'
            : 'confidence_below_threshold',
        capture_confidence,
        router_threshold: routerThreshold,
      },
      notes: null,
      sequence: 1,
      created_at: now.toISOString(),
    };
    await deps.eventLog.append(nudge);
  }

  return { capture: captureRow, shouldDispatch, deduplicated: false };
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * SHA-256 of `userText \n assistantText`. Used both as the capture's
 * `exchange_hash` (dedup key) and as one of the audit-chain payload
 * fields so a verifier can re-derive it.
 */
export function computeExchangeHash(
  userText: string,
  assistantText: string,
): string {
  return createHash('sha256')
    .update(`${userText}\n${assistantText}`)
    .digest('hex');
}

function dedupeByCanonical(
  entities: ReadonlyArray<ResolvedEntity>,
): ReadonlyArray<ResolvedEntity> {
  const byKey = new Map<string, ResolvedEntity>();
  for (const e of entities) {
    const key = `${e.type}:${e.canonical_id}`;
    const existing = byKey.get(key);
    if (!existing || e.confidence > existing.confidence) {
      byKey.set(key, e);
    }
  }
  return [...byKey.values()];
}
