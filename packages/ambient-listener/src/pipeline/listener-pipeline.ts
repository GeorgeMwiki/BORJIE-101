/**
 * Listener pipeline — VAD → diarise → STT → redact → extract → persist.
 *
 * The pipeline is the only place the consent gate, the kill-switch
 * gate, and the silent-disable counters are invoked. Every gap routes
 * to a `silent-disabled` outcome — NEVER a partial capture.
 *
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * Decision 4 — observations carry `provenance.consent_state` verbatim
 * into the cognitive-memory cell.
 */

import type { ConsentManager } from '../consent/consent-manager.js';
import type { KillSwitch } from '../consent/kill-switch.js';
import type {
  AmbientCapture,
  AmbientCapturesRepository,
  AuditChainPort,
  CognitiveMemoryWriterPort,
  DiarisePort,
  EntityExtractorPort,
  IntentExtractorPort,
  MetricsPort,
  PiiRedactorPort,
  PipelineInput,
  PipelineOutcome,
  SentimentExtractorPort,
  SilentDisableReason,
  SttPort,
  VadPort,
} from '../types.js';

export interface ListenerPipelineDeps {
  readonly consentManager: ConsentManager;
  readonly killSwitch: KillSwitch;
  readonly vad: VadPort;
  readonly diarise: DiarisePort;
  readonly stt: SttPort;
  readonly redactor: PiiRedactorPort;
  readonly intentExtractor: IntentExtractorPort;
  readonly entityExtractor: EntityExtractorPort;
  readonly sentimentExtractor: SentimentExtractorPort;
  readonly capturesRepo: AmbientCapturesRepository;
  readonly audit: AuditChainPort;
  /** Optional — when present, every capture is observed into cognitive-memory. */
  readonly cogMemoryWriter?: CognitiveMemoryWriterPort;
  /** Optional — when present, counters are incremented; defaults to a no-op. */
  readonly metrics?: MetricsPort;
  /** Test seam — defaults to `crypto.randomUUID()` or a fallback. */
  readonly idGen?: () => string;
  /** Language tag passed to the STT port. Defaults to 'sw'. */
  readonly language?: string;
}

export interface ListenerPipeline {
  capture(input: PipelineInput): Promise<PipelineOutcome>;
}

export function createListenerPipeline(
  deps: ListenerPipelineDeps,
): ListenerPipeline {
  const idGen = deps.idGen ?? (() => generateUuidV4Fallback());
  // English default per CLAUDE.md (flipped 2026-05). Hosts that want
  // Swahili ambient transcription must pass `language: 'sw'` explicitly.
  const language = deps.language ?? 'en';
  const metrics = deps.metrics ?? createNoopMetrics();

  function silent(reason: SilentDisableReason): PipelineOutcome {
    metrics.incrementCounter('ambient_silent_disables_total', {
      reason,
    });
    return { outcome: 'silent-disabled', reason };
  }

  async function capture(input: PipelineInput): Promise<PipelineOutcome> {
    // 1) Consent gate — silent disable on any gap.
    const consentCheck = await deps.consentManager.check({
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      channel: input.channel,
    });

    if (!consentCheck.may_listen) {
      const reason: SilentDisableReason = (() => {
        switch (consentCheck.effective_state) {
          case 'not-set':
            return 'consent-not-set';
          case 'revoked':
            return 'consent-revoked';
          case 'expired':
            return 'consent-expired-90d';
          default:
            return 'consent-not-set';
        }
      })();
      return silent(reason);
    }

    // 2) Kill-switch gate — wins over consent.
    const killCheck = await deps.killSwitch.isActive(
      input.tenant_id,
      input.user_id,
    );
    if (killCheck.active) {
      const reason: SilentDisableReason =
        killCheck.scope === 'org' ? 'kill-switch-org' : 'kill-switch-user';
      return silent(reason);
    }

    // 3) VAD — drop frame if no voice.
    let vadHit;
    try {
      vadHit = await deps.vad.detect(input.audio);
    } catch {
      return silent('vad-error');
    }
    if (!vadHit) {
      return silent('vad-error');
    }

    // 4) Diarise.
    const speakers = await deps.diarise.diarise(input.audio, vadHit);

    // 5) STT.
    let sttResult;
    try {
      sttResult = await deps.stt.transcribe({
        audio: input.audio,
        hit: vadHit,
        speakers,
        language,
      });
    } catch {
      return silent('stt-error');
    }

    // 6) Redact BEFORE extract — LLM never sees raw PII.
    let redacted;
    try {
      redacted = await deps.redactor.redact({
        tenant_id: input.tenant_id,
        source_session_id: input.source_session_id,
        transcript: sttResult.transcript,
      });
    } catch {
      metrics.incrementCounter('ambient_redact_failures_total');
      return silent('redactor-error');
    }

    // 7) Extract intent + entities (always); sentiment only if opted-in.
    let intent;
    let entities;
    try {
      [intent, entities] = await Promise.all([
        deps.intentExtractor.extract(redacted),
        deps.entityExtractor.extract(redacted),
      ]);
    } catch {
      return silent('extractor-error');
    }

    let sentiment: number | null = null;
    if (consentCheck.consent?.sentiment_consent === true) {
      try {
        sentiment = await deps.sentimentExtractor.extract(redacted);
      } catch {
        // Sentiment failure does NOT silent-disable the whole pipeline
        // (sentiment is the soft tier). Drop the value and continue.
        sentiment = null;
      }
    }

    // 8) Persist with audit chain.
    const captured_at = (input.captured_at ?? input.received_at).toISOString();
    const prev = await deps.capturesRepo.latestForSession(
      input.tenant_id,
      input.source_session_id,
    );
    const prev_hash = prev?.audit_hash ?? null;
    const audit_hash = await deps.audit.append({
      op: 'ambient.capture',
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      channel: input.channel,
      source_session_id: input.source_session_id,
      captured_at,
      intent,
      entities,
      sentiment,
      consent_state: consentCheck.consent?.consent_state ?? 'granted',
      prev_hash,
    });

    const capture: AmbientCapture = {
      id: idGen(),
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      channel: input.channel,
      source_session_id: input.source_session_id,
      captured_at,
      redacted_text: redacted.text,
      intent,
      entities,
      sentiment,
      audit_hash,
      prev_hash,
    };

    await deps.capturesRepo.insert(capture);
    metrics.incrementCounter('ambient_captures_total', {
      channel: input.channel,
      intent,
    });

    // 9) Observe into cognitive-memory — stamp the consent_state
    //    verbatim per FOUNDER_LOCKED Decision 4.3.
    if (deps.cogMemoryWriter) {
      try {
        await deps.cogMemoryWriter.observe({
          tenant_id: input.tenant_id,
          user_id: input.user_id,
          redacted_text: redacted.text,
          intent,
          entities,
          sentiment,
          consent_state: consentCheck.consent?.consent_state ?? 'granted',
          captured_at,
          source_session_id: input.source_session_id,
        });
      } catch {
        // Cognitive-memory write failure does NOT silent-disable; the
        // capture row is already persisted (and the audit chain
        // captures the attempt).
        metrics.incrementCounter('ambient_cogmem_failures_total');
      }
    }

    return { outcome: 'listening', capture };
  }

  return { capture };
}

function createNoopMetrics(): MetricsPort {
  return {
    incrementCounter() {
      /* no-op */
    },
  };
}

function generateUuidV4Fallback(): string {
  const hex = (n: number) => Math.floor(n).toString(16).padStart(2, '0');
  const rb = () => Math.floor(Math.random() * 256);
  const bytes = new Array(16).fill(0).map(rb);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = bytes.map(hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
