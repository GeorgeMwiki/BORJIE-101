/**
 * Modality executor — the arbiter → engine → PROPOSAL binding.
 *
 * When the modality arbiter lifts a turn to a `run_modality` Decision
 * (`document` / `media` / `forecast`), the tool-dispatcher's `modalityHandler`
 * calls THIS executor. It:
 *
 *   1. routes the payload to the matching engine (forecast / media / document)
 *      to produce a real ARTIFACT — the SAME engines the capability brain-tools
 *      wrap, so there is one execution path of record;
 *   2. turns the artifact + the arbiter's reasoned-need (tau + evidence +
 *      autonomy posture) into a `ModalityProposal` via the pure proposal
 *      builder — which NEVER mutates the UI;
 *   3. hands the proposal back to the caller through the `proposalSink` port
 *      so the gateway routes `payload` out via the EXISTING portal-genui
 *      `tab_proposal` channel (ambient notice + Open/Undo).
 *
 * The INVARIANT (rule 3) is structural: this executor returns a proposal; it
 * does NOT persist a tab or mutate a surface. Auto-spawn happens ONLY when the
 * arbiter's posture is `auto` (an explicitly auto flow whose rail allowed it)
 * AND even then the sink emits a reversible ambient spawn — never a silent
 * mutation. Money / licence / deletion never reach here as a modality; they
 * stay `tool_call` / `spawn_sub_md` gated by the rails.
 *
 * @module composition/modality-capability/modality-executor
 */

import type { ForecastEngine } from '@borjie/forecast-engine';
import type { MediaEngine, MediaRequest } from '@borjie/media-engine';
import type { DocumentStudio } from '@borjie/document-studio';

import {
  buildModalityProposal,
  type ModalityProposal,
  type ModalityArtifactKind,
  type ReasonedNeed,
} from './modality-proposal.js';
import type { MediaContextProvider } from './media-context.js';

/** Where a built proposal is emitted (the gateway routes it to the FE). */
export interface ModalityProposalSink {
  /**
   * Surface a proposal. Implementations route `proposal.payload` out via the
   * portal-genui `tab_proposal` channel. They NEVER persist a tab here — only
   * an explicit owner approval (FE → POST persist) mutates a surface. Returns
   * the surfaced proposal id for telemetry.
   */
  emit(proposal: ModalityProposal): Promise<{ readonly surfacedProposalId: string }>;
}

export interface ModalityExecutorDeps {
  readonly forecastEngine?: ForecastEngine;
  readonly mediaEngine?: MediaEngine;
  readonly mediaContextProvider?: MediaContextProvider;
  readonly documentStudio?: DocumentStudio;
  readonly proposalSink: ModalityProposalSink;
  readonly logger?: { warn(meta: object, msg: string): void; info?(meta: object, msg: string): void };
}

/** The result the executor hands the dispatcher (`modality_ack.output`). */
export interface ModalityExecutionResult {
  readonly modality: ModalityArtifactKind;
  /** True when a proposal was surfaced (warranted + evidence present). */
  readonly proposed: boolean;
  /** The autonomy posture the proposal carried (propose / auto). */
  readonly posture: 'propose' | 'auto' | null;
  /** The surfaced proposal id, when proposed. */
  readonly surfacedProposalId?: string;
  /** A short reason when nothing was proposed (low need / no engine). */
  readonly skippedReason?: string;
}

/** Read a string from a loose payload bag. */
function str(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === 'string' ? v : undefined;
}

/** Derive the reasoned-need from the arbiter's lifted payload. */
function reasonedNeedFrom(
  payload: Readonly<Record<string, unknown>>,
  evidenceIds: ReadonlyArray<string>,
  reason: string,
): ReasonedNeed {
  const score = typeof payload['score'] === 'number' ? (payload['score'] as number) : 0;
  // INVARIANT rule 2 — warranted only when the arbiter cleared tau AND
  // evidence is present. The arbiter sets `warranted` explicitly; absent it,
  // we require a non-trivial score AND evidence (fail-cautious).
  const warranted =
    payload['warranted'] === true || (score > 0 && evidenceIds.length > 0);
  // Posture: `auto` ONLY when the arbiter explicitly set an auto flow whose
  // rail allowed it; default `propose`.
  const posture = payload['posture'] === 'auto' ? 'auto' : 'propose';
  return { warranted, score, evidenceIds, reason, posture };
}

/**
 * Execute a forecast modality: run the engine over the payload, then propose.
 */
async function executeForecast(
  payload: Readonly<Record<string, unknown>>,
  tenantId: string,
  userId: string | null,
  deps: ModalityExecutorDeps,
): Promise<ModalityExecutionResult> {
  if (!deps.forecastEngine) {
    return { modality: 'forecast', proposed: false, posture: null, skippedReason: 'no-forecast-engine' };
  }
  const target = str(payload, 'target') ?? 'mining.A1.commodity_price';
  const valuesRaw = Array.isArray(payload['values']) ? (payload['values'] as unknown[]) : [];
  const values = valuesRaw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) {
    return { modality: 'forecast', proposed: false, posture: null, skippedReason: 'empty-series' };
  }
  const horizon =
    typeof payload['horizon'] === 'number' ? Math.max(1, Math.trunc(payload['horizon'] as number)) : 6;
  const result = await deps.forecastEngine.forecast({
    tenantId,
    target,
    horizon,
    series: { seriesId: `${tenantId}:${target}`, values },
  });
  const evidenceIds = result.evidenceIds.map((e) => e.id);
  const need = reasonedNeedFrom(
    payload,
    evidenceIds,
    str(payload, 'reason') ?? `Calibrated ${target} forecast (advisory) ready to review.`,
  );
  const proposal = buildModalityProposal({
    artifactKind: 'forecast',
    tenantId,
    userId,
    need,
    title: `Forecast: ${target}`,
    description: `Advisory ${horizon}-step forecast (coverage ${(result.conformalCoverage * 100).toFixed(0)}%).`,
    fieldLabels: ['Target', 'Horizon', 'Median', 'Lower', 'Upper', 'Beats floor'],
    artifact: { kind: 'forecast', forecastId: result.forecastId, target, evidence_ids: evidenceIds },
  });
  return surface('forecast', proposal, deps);
}

/** Execute a media modality: generate the artifact, then propose. */
async function executeMedia(
  payload: Readonly<Record<string, unknown>>,
  tenantId: string,
  userId: string | null,
  deps: ModalityExecutorDeps,
): Promise<ModalityExecutionResult> {
  if (!deps.mediaEngine || !deps.mediaContextProvider) {
    return { modality: 'media', proposed: false, posture: null, skippedReason: 'no-media-engine' };
  }
  const prompt = str(payload, 'prompt') ?? '';
  if (!prompt) {
    return { modality: 'media', proposed: false, posture: null, skippedReason: 'empty-prompt' };
  }
  const mediaKind = (str(payload, 'mediaKind') ?? 'investor_brand_video') as MediaRequest['kind'];
  const evidenceIds = Array.isArray(payload['evidence_ids'])
    ? (payload['evidence_ids'] as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  const ctx = deps.mediaContextProvider.contextFor(tenantId);
  const artifact = await deps.mediaEngine.generate(
    {
      kind: mediaKind,
      tenantId,
      prompt,
      inputs: [],
      locale: payload['locale'] === 'sw' ? 'sw' : 'en',
      evidenceIds,
    },
    ctx,
  );
  const need = reasonedNeedFrom(
    payload,
    artifact.evidenceIds,
    str(payload, 'reason') ?? `Generated ${artifact.modality} ready to review.`,
  );
  const proposal = buildModalityProposal({
    artifactKind: 'media',
    tenantId,
    userId,
    need,
    title: `Media: ${artifact.kind}`,
    description: `${artifact.modality} (${artifact.format}, ${artifact.approvalState}).`,
    fieldLabels: ['Kind', 'Format', 'Provider', 'Approval state', 'Watermark'],
    artifact: {
      kind: 'media',
      artifactId: artifact.id,
      modality: artifact.modality,
      approvalState: artifact.approvalState,
      evidence_ids: artifact.evidenceIds,
    },
  });
  return surface('media', proposal, deps);
}

/** Execute a document modality: run the studio, then propose. */
async function executeDocument(
  payload: Readonly<Record<string, unknown>>,
  tenantId: string,
  userId: string | null,
  deps: ModalityExecutorDeps,
): Promise<ModalityExecutionResult> {
  if (!deps.documentStudio) {
    return { modality: 'document', proposed: false, posture: null, skippedReason: 'no-document-studio' };
  }
  const docType = str(payload, 'docType') ?? '';
  if (!docType) {
    return { modality: 'document', proposed: false, posture: null, skippedReason: 'no-docType' };
  }
  const data = payload['data'] ?? {};
  const citationsRaw = Array.isArray(payload['citations']) ? (payload['citations'] as unknown[]) : [];
  const doc = await deps.documentStudio.generate({
    docType,
    tenantId,
    actorId: userId ?? 'mr-mwikila',
    data,
    bucket: str(payload, 'bucket') ?? 'borjie-documents',
    citations: citationsRaw as never,
  });
  const evidenceIds = doc.citations.map((c) => c.id);
  const need = reasonedNeedFrom(
    payload,
    evidenceIds,
    str(payload, 'reason') ?? `Generated ${doc.docType} ready to review.`,
  );
  const proposal = buildModalityProposal({
    artifactKind: 'document',
    tenantId,
    userId,
    need,
    title: `Document: ${doc.docType}`,
    description: `${doc.artifacts.length} format(s), locale ${doc.locale}.`,
    fieldLabels: ['Doc type', 'Locale', 'Formats', 'Archive id', 'SHA-256'],
    artifact: {
      kind: 'document',
      docType: doc.docType,
      archiveIds: doc.artifacts.map((a) => a.archived.artifactId),
      evidence_ids: evidenceIds,
    },
  });
  return surface('document', proposal, deps);
}

/** Common surfacing path — emit the proposal (or record why none surfaced). */
async function surface(
  modality: ModalityArtifactKind,
  proposal: ModalityProposal | null,
  deps: ModalityExecutorDeps,
): Promise<ModalityExecutionResult> {
  if (!proposal) {
    // INVARIANT rule 2 — low need / empty evidence proposes NOTHING.
    return { modality, proposed: false, posture: null, skippedReason: 'low-need-or-no-evidence' };
  }
  const { surfacedProposalId } = await deps.proposalSink.emit(proposal);
  return {
    modality,
    proposed: true,
    posture: proposal.posture,
    surfacedProposalId,
  };
}

/**
 * Build the modality executor. Returns a single `execute(modality, payload,
 * ctx)` the dispatcher's `modalityHandler` invokes. `tab`/`workflow`/`loop`
 * are NOT handled here (they keep their existing paths); only the three
 * ARTIFACT modalities route to engines + proposals.
 */
export interface ModalityExecutor {
  execute(args: {
    readonly modality: 'tab' | 'document' | 'media' | 'workflow' | 'loop' | 'forecast';
    readonly payload: Readonly<Record<string, unknown>>;
    readonly tenantId: string | null;
    readonly userId: string | null;
  }): Promise<ModalityExecutionResult | null>;
}

export function createModalityExecutor(
  deps: ModalityExecutorDeps,
): ModalityExecutor {
  return {
    async execute(args): Promise<ModalityExecutionResult | null> {
      const tenantId = args.tenantId ?? '';
      if (!tenantId) {
        deps.logger?.warn?.({ modality: args.modality }, 'modality-executor: no tenant — skipping');
        return null;
      }
      try {
        switch (args.modality) {
          case 'forecast':
            return await executeForecast(args.payload, tenantId, args.userId, deps);
          case 'media':
            return await executeMedia(args.payload, tenantId, args.userId, deps);
          case 'document':
            return await executeDocument(args.payload, tenantId, args.userId, deps);
          default:
            // tab / workflow / loop are NOT artifact modalities — not ours.
            return null;
        }
      } catch (err) {
        deps.logger?.warn?.(
          { modality: args.modality, reason: err instanceof Error ? err.message : String(err) },
          'modality-executor: execution failed — no proposal surfaced',
        );
        return {
          modality: args.modality as ModalityArtifactKind,
          proposed: false,
          posture: null,
          skippedReason: err instanceof Error ? err.message : 'execution-error',
        };
      }
    },
  };
}
