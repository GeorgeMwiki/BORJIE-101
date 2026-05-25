/**
 * IntakeOrchestrator — multi-engine OCR routing with deterministic
 * fallback. Caller passes a list of engines (any value satisfying
 * `IntakeEngine`, including adapters from `@borjie/document-ai/
 * ocr`). The orchestrator scores the input, picks the engine
 * ordering, tries each in turn, and either returns the first
 * accepted extraction or fires an escalation.
 *
 * Routing rules (see Docs/DOCUMENT_QUALITY_RESEARCH_2026-05-24.md):
 *   - Engines that don't support the detected/hinted language sink.
 *   - Engines stay in the chain in caller-defined order; we don't
 *     re-rank silently (deterministic replay is the priority).
 *   - First engine whose confidence ≥ `fallback.minPrimaryConfidence`
 *     wins. Others are recorded but their output is discarded.
 *   - All engines failed → caller's escalation handler is invoked.
 *
 * Caching: results keyed by `sha256(bytes) + lang` for cross-call
 * idempotency. Cache hits skip all engine calls.
 */

import type {
  AuditChainStore,
} from '../audit/index.js';
import { sha256Hex } from '../audit/sha256.js';
import type {
  DocumentBytes,
  EngineId,
  EngineResult,
  ExtractedDocument,
  FallbackPolicy,
  IntakeEngine,
  IntakeHints,
  IntakeRequest,
} from '../types.js';
import { DEFAULT_FALLBACK_POLICY } from '../types.js';

export interface IntakeOrchestratorDeps {
  readonly engines: ReadonlyArray<IntakeEngine>;
  readonly audit: AuditChainStore;
  readonly fallback?: FallbackPolicy;
  /** Optional escalation hook; called when all engines fail. */
  readonly onAllFailed?: (req: IntakeRequest, attempts: ReadonlyArray<EngineResult<ExtractedDocument>>) => Promise<void>;
}

export interface IntakeOrchestrator {
  extract(req: IntakeRequest): Promise<ExtractedDocument>;
  /** Inspection helper for tests / dashboards. */
  cacheSize(): number;
}

type CacheKey = string;

export function createIntakeOrchestrator(deps: IntakeOrchestratorDeps): IntakeOrchestrator {
  const fallback = deps.fallback ?? DEFAULT_FALLBACK_POLICY;
  const cache = new Map<CacheKey, ExtractedDocument>();
  let intakeCounter = 0;

  async function cacheKey(doc: DocumentBytes, hints?: IntakeHints): Promise<CacheKey> {
    const langKey = hints?.lang?.join(',') ?? 'auto';
    const hash = await sha256Hex(doc.bytes);
    return `${hash}::${langKey}`;
  }

  function pickOrder(engines: ReadonlyArray<IntakeEngine>, hints?: IntakeHints): IntakeEngine[] {
    const langs = hints?.lang ?? [];
    if (langs.length === 0) return [...engines];
    // Engines that explicitly support the hinted language float to top;
    // wildcard '*' engines stay in original position; others sink.
    const supports = (e: IntakeEngine): boolean =>
      e.supportedLanguages.some((l) => l === '*' || langs.includes(l));
    const supported = engines.filter(supports);
    const rest = engines.filter((e) => !supports(e));
    return [...supported, ...rest];
  }

  return {
    cacheSize: () => cache.size,
    async extract(req) {
      intakeCounter += 1;
      const intakeId = `intake-${Date.now()}-${intakeCounter}`;
      const key = await cacheKey(req.doc, req.hints);
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const order = pickOrder(deps.engines, req.hints);
      const startedAtMs = Date.now();
      const attempts: EngineResult<ExtractedDocument>[] = [];

      for (const engine of order) {
        if (Date.now() - startedAtMs > fallback.totalBudgetMs) break;
        const t0 = Date.now();
        await deps.audit.append({
          tenantId: req.tenantId,
          kind: 'intake_engine_attempt',
          operationId: intakeId,
          engineId: engine.id,
          details: { mime: req.doc.mime, hints: req.hints ?? {} },
          recordedAtIso: new Date().toISOString(),
        });
        try {
          const value = await engine.extract(req.doc, req.hints);
          const latencyMs = Date.now() - t0;
          const result: EngineResult<ExtractedDocument> = {
            engineId: engine.id,
            ok: value.confidence >= fallback.minPrimaryConfidence,
            value,
            confidence: value.confidence,
            latencyMs,
          };
          attempts.push(result);
          if (result.ok && result.value !== undefined) {
            await deps.audit.append({
              tenantId: req.tenantId,
              kind: 'intake_engine_success',
              operationId: intakeId,
              engineId: engine.id,
              details: { confidence: value.confidence, latencyMs },
              recordedAtIso: new Date().toISOString(),
            });
            const accepted: ExtractedDocument = { ...result.value, intakeId };
            cache.set(key, accepted);
            return accepted;
          }
          await deps.audit.append({
            tenantId: req.tenantId,
            kind: 'intake_engine_failure',
            operationId: intakeId,
            engineId: engine.id,
            details: {
              error: `confidence_below_threshold:${value.confidence}<${fallback.minPrimaryConfidence}`,
              latencyMs,
            },
            recordedAtIso: new Date().toISOString(),
          });
        } catch (err) {
          const latencyMs = Date.now() - t0;
          const message = err instanceof Error ? err.message : String(err);
          attempts.push({
            engineId: engine.id,
            ok: false,
            error: message,
            latencyMs,
          });
          await deps.audit.append({
            tenantId: req.tenantId,
            kind: 'intake_engine_failure',
            operationId: intakeId,
            engineId: engine.id,
            details: { error: message, latencyMs },
            recordedAtIso: new Date().toISOString(),
          });
        }
      }

      // All engines fell short. Fire escalation hook and throw — the
      // throw is the contract: orchestrator never returns a result that
      // failed the confidence gate.
      if (deps.onAllFailed) {
        await deps.onAllFailed(req, attempts);
      }
      const engineIds: EngineId[] = attempts.map((a) => a.engineId);
      throw new Error(
        `IntakeOrchestrator: all engines failed (tried ${engineIds.join(', ')})`,
      );
    },
  };
}
