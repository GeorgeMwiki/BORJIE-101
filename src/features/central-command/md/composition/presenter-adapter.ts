/**
 * MD presenter adapter — bridges the orchestrator's `MdPresenterPort`
 * onto the concrete `processOwnerTurn` service from
 * `@/features/central-command/md/presenter`.
 *
 * The adapter passes the owner's text through the presenter pipeline:
 *   intent-parser ─▶ data-fetcher ─▶ spec-builder
 *
 * Returns:
 *   - `MdPresenterResult` when an inline-data response was produced.
 *   - `null` when the message isn't an inline-data request, or when
 *     the underlying data lookup is empty. The orchestrator falls back
 *     to the normal NBA-driven turn.
 *
 * Failures throw never escape — the adapter logs + returns `null`.
 *
 * @module features/central-command/md/composition/presenter-adapter
 */

import type {
  MdPresenterPort,
  MdPresenterRequest,
  MdPresenterResult,
} from "@/features/central-command/md/core/contracts";

import type { RequestContext } from "./request-context";

/**
 * Function the composition root injects. Mirrors the signature of
 * `processOwnerTurn` so production wires the real service in and
 * tests inject a stub.
 */
export type PresenterProcessFn = (
  text: string,
  ctx: {
    readonly userId: string;
    readonly tenantId: string;
    readonly tier:
      | "borrower"
      | "officer"
      | "org-admin"
      | "borjie-admin"
      | "sovereign";
    readonly correlationId: string;
    readonly sessionId: string;
  },
) => Promise<{
  readonly spec: Readonly<Record<string, unknown>>;
  readonly request: { readonly subject: string; readonly kind: string };
  readonly traceId: string;
} | null>;

export interface PresenterAdapterDeps {
  readonly process: PresenterProcessFn;
  readonly ctx: RequestContext;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

export function createPresenterAdapter(
  deps: PresenterAdapterDeps,
): MdPresenterPort {
  const { ctx, process, logger } = deps;

  return Object.freeze({
    async process(req: MdPresenterRequest): Promise<MdPresenterResult | null> {
      logger?.debug("md.presenter.process", {
        correlationId: ctx.correlationId,
        textLen: req.text.length,
      });
      try {
        const result = await process(req.text, {
          userId: req.userId,
          tenantId: req.tenantId,
          tier: req.tier,
          correlationId: req.correlationId,
          sessionId: req.sessionId,
        });
        if (!result) return null;
        return Object.freeze({
          traceId: result.traceId,
          spec: result.spec,
          subject: result.request.subject,
          kind: result.request.kind,
        });
      } catch (e) {
        logger?.debug("md.presenter.process.failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        return null;
      }
    },
  });
}
