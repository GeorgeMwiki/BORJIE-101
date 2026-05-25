/**
 * OutputOrchestrator — multi-engine rendering with engine-by-engine
 * fallover and per-engine timeout.
 *
 * The orchestrator does NOT enforce quality gates itself; gates run
 * one level up so a single render can be evaluated against multiple
 * gates (composition lives in the public façade). The orchestrator's
 * job is exactly:
 *   1. Pick engines that claim to support `format`.
 *   2. Use `template.engineHint` first if any engine matches the hint.
 *   3. Apply per-engine timeout (default 15 s).
 *   4. Record every attempt + engine result to the audit chain.
 *   5. Return the first successful render; throw if all engines fail.
 */

import type { AuditChainStore } from '../audit/index.js';
import { sha256Hex } from '../audit/sha256.js';
import type {
  EngineResult,
  OutputEngine,
  OutputRequest,
  RenderedDocument,
  SupportedFormat,
} from '../types.js';

export interface OutputOrchestratorDeps {
  readonly engines: ReadonlyArray<OutputEngine>;
  readonly audit: AuditChainStore;
  /** Optional callback when all engines fail. */
  readonly onAllFailed?: (
    req: OutputRequest,
    attempts: ReadonlyArray<EngineResult<RenderedDocument>>,
  ) => Promise<void>;
}

export interface OutputOrchestrator {
  render(req: OutputRequest): Promise<RenderedDocument>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`engine_timeout_after_${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function pickChain(
  engines: ReadonlyArray<OutputEngine>,
  format: SupportedFormat,
  hint?: string,
): OutputEngine[] {
  const capable = engines.filter((e) => e.supportedFormats.includes(format));
  if (hint === undefined) return capable;
  const hinted = capable.filter((e) => e.id === hint);
  const rest = capable.filter((e) => e.id !== hint);
  return [...hinted, ...rest];
}

export function createOutputOrchestrator(deps: OutputOrchestratorDeps): OutputOrchestrator {
  let counter = 0;

  return {
    async render(req) {
      counter += 1;
      const outputId = `output-${Date.now()}-${counter}`;
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const chain = pickChain(deps.engines, req.format, req.template.engineHint);
      const attempts: EngineResult<RenderedDocument>[] = [];

      if (chain.length === 0) {
        await deps.audit.append({
          tenantId: req.tenantId,
          kind: 'output_engine_failure',
          operationId: outputId,
          engineId: null,
          details: { error: `no_engine_supports_format:${req.format}` },
          recordedAtIso: new Date().toISOString(),
        });
        if (deps.onAllFailed) await deps.onAllFailed(req, attempts);
        throw new Error(`OutputOrchestrator: no engine supports format ${req.format}`);
      }

      for (const engine of chain) {
        const t0 = Date.now();
        await deps.audit.append({
          tenantId: req.tenantId,
          kind: 'output_engine_attempt',
          operationId: outputId,
          engineId: engine.id,
          details: { format: req.format, templateId: req.template.id },
          recordedAtIso: new Date().toISOString(),
        });
        try {
          const value = await withTimeout(
            engine.render(req.template, req.data, req.format),
            timeoutMs,
          );
          const latencyMs = Date.now() - t0;
          // Recompute sha256 to guarantee provenance even if engine
          // returned a placeholder hash.
          const sha256 = await sha256Hex(value.bytes);
          const stamped: RenderedDocument = { ...value, sha256, outputId };
          attempts.push({ engineId: engine.id, ok: true, value: stamped, latencyMs });
          await deps.audit.append({
            tenantId: req.tenantId,
            kind: 'output_engine_success',
            operationId: outputId,
            engineId: engine.id,
            details: { format: req.format, bytes: stamped.bytes.length, sha256, latencyMs },
            recordedAtIso: new Date().toISOString(),
          });
          return stamped;
        } catch (err) {
          const latencyMs = Date.now() - t0;
          const message = err instanceof Error ? err.message : String(err);
          attempts.push({ engineId: engine.id, ok: false, error: message, latencyMs });
          await deps.audit.append({
            tenantId: req.tenantId,
            kind: 'output_engine_failure',
            operationId: outputId,
            engineId: engine.id,
            details: { error: message, latencyMs },
            recordedAtIso: new Date().toISOString(),
          });
        }
      }

      if (deps.onAllFailed) await deps.onAllFailed(req, attempts);
      throw new Error(
        `OutputOrchestrator: all engines failed (tried ${attempts.map((a) => a.engineId).join(', ')})`,
      );
    },
  };
}
