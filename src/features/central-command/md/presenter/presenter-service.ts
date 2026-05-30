/**
 * Presenter Service — public entry point for the Inline-Chat Data
 * Presenter. The command-chat route calls `processOwnerTurn(text,
 * ctx)`; when the owner asked for inline data, the service returns a
 * validated `GenerativeUiSpec` that the SSE layer emits as a
 * `generative-ui` event. When the turn is plain chat, it returns
 * null and chat continues normally.
 *
 * Pipeline (all immutable, no shared state):
 *
 *   text  ──▶ intent-parser ──▶ InlineDataRequest? ──▶ data-fetcher
 *                                       │
 *                                       ▼
 *                                  spec-builder ──▶ owner-style-tinter
 *                                                       │
 *                                                       ▼
 *                                              GenerativeUiSpec
 *
 * Every successful path produces a `DecisionTrace` via the carboni-ai
 * recorder (HARD RULE in CLAUDE.md).
 *
 * @module features/central-command/md/presenter/presenter-service
 */

import {
  startTrace,
  type TraceRecorder,
  type TraceStore,
  InMemoryTraceStore,
} from "@/core/borjie-ai/decision-trace";
import { createLogger } from "@/lib/logger";
import type { GenerativeUiSpec } from "@/core/brain/generative-ui/types";

import { fetchInlineData } from "./data-fetcher";
import { parseOwnerIntent } from "./intent-parser";
import { buildPresenterSpec } from "./spec-builder";
import { tintForOwnerStyle } from "./owner-style-tinter";
import type { InlineDataRequest, PresenterContext } from "./types";

const log = createLogger("md.presenter");

// ---------------------------------------------------------------------------
// Decision-trace store injection (test-friendly)
// ---------------------------------------------------------------------------

let traceStore: TraceStore = new InMemoryTraceStore();

export function setPresenterTraceStore(store: TraceStore): void {
  traceStore = store;
}

export function getPresenterTraceStore(): TraceStore {
  return traceStore;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface ProcessResult {
  readonly spec: GenerativeUiSpec;
  readonly request: InlineDataRequest;
  readonly traceId: string;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * Run the presenter pipeline against an owner chat turn.
 *
 * Returns:
 *   - `ProcessResult` when the turn was classified as an inline-data
 *     request AND a spec was produced.
 *   - `null` when the turn is not inline data, or when no data was
 *     available (the caller falls back to plain chat).
 *
 * Throws only on programmer error (Zod failure mid-pipeline). Network
 * / Supabase errors are absorbed: the fetcher returns empty rows and
 * the spec-builder produces a graceful "no data" markdown spec.
 */
export async function processOwnerTurn(
  text: string,
  ctx: PresenterContext,
): Promise<ProcessResult | null> {
  const request = parseOwnerIntent({
    text,
    ownerStyleHint: ctx.ownerStyleHint,
  });
  if (!request) {
    log.debug("no inline-data intent", { corr: ctx.correlationId });
    return null;
  }

  const recorder: TraceRecorder = startTrace({
    correlationId: ctx.correlationId,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    tier: ctx.tier,
    model: "presenter.rules-v1",
    modelTier: "external",
    input: {
      text,
      portalId: "central-command",
      route: "md/presenter",
    },
  });

  recorder.considerTool("inline-presenter", 1);
  recorder.addReasoning(
    `classified subject=${request.subject} kind=${request.kind}`,
  );

  const startedAt = Date.now();
  let result;
  try {
    result = await fetchInlineData(request, ctx);
  } catch (err) {
    log.error("presenter fetch failed", {
      err: err instanceof Error ? err.message : String(err),
      subject: request.subject,
      corr: ctx.correlationId,
    });
    await recorder.finalize(
      {
        type: "presenter.error",
        target: request.subject,
        payload: { error: "fetch_failed" },
      },
      traceStore,
    );
    return null;
  }
  const latencyMs = Date.now() - startedAt;
  recorder.useTool({
    name: "fetchInlineData",
    input: { subject: request.subject, filters: request.filters ?? {} },
    output: {
      rowCount: result.rows.length,
      hasSeries: Boolean(result.series && result.series.length > 0),
      hasMetrics: Boolean(result.metrics && result.metrics.length > 0),
      hasFile: Boolean(result.file),
      hasOrgChart: Boolean(result.orgChart && result.orgChart.length > 0),
    },
    latencyMs,
  });

  const rawSpec = buildPresenterSpec({ request, result });
  const tinted = tintForOwnerStyle({
    spec: rawSpec,
    hint: request.ownerStyleHint,
  });

  recorder.addReasoning(
    `built spec kind=${tinted.kind} (tint=${request.ownerStyleHint ?? "balanced"})`,
  );

  const trace = await recorder.finalize(
    {
      type: "presenter.render",
      target: request.subject,
      payload: {
        kind: tinted.kind,
        rowCount: result.rows.length,
      },
    },
    traceStore,
  );

  return Object.freeze({
    spec: tinted,
    request,
    traceId: trace.id,
  });
}
