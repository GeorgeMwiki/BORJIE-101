/**
 * Auto-populate adapter — bridges the orchestrator's narrow
 * `MdAutoPopulatePort.populate(req)` contract to the underlying
 * `processChat(turnId, text, ctx)` service.
 *
 * Semantic mismatch handled here:
 *   - The orchestrator asks "populate fields for target X using the
 *     business state". The service does "extract entities from chat
 *     text and persist them".
 *   - We translate by treating `req.hint` as the chat text and `req.target`
 *     as a filter that selects which extracted entity kind to project
 *     onto the `fields` shape.
 *
 * If `req.hint` is empty or no entities match the target, the adapter
 * returns `{ ok: true, fields: {}, gaps: [...] }` — the orchestrator can
 * then decide whether to surface a "needs manual entry" prompt.
 *
 * @module features/central-command/md/composition/auto-populate-adapter
 */

import { requireTierPolicy } from "@/core/governance/tier-policy";
import type {
  MdAutoPopulatePort,
  MdAutoPopulateRequest,
  MdAutoPopulateResult,
} from "@/features/central-command/md/core/contracts";

import type { RequestContext } from "./request-context";

/**
 * The auto-populate service's `processChat` signature (re-typed locally
 * to avoid a hard dependency on the service module — the composition
 * root passes in the function reference).
 */
export type ProcessChatFn = (
  turnId: string,
  text: string,
  ctx: {
    readonly orgId: string;
    readonly userId: string;
    readonly tier: string;
    readonly sessionId: string;
    readonly correlationId: string;
  },
) => Promise<{
  readonly entities: ReadonlyArray<{
    readonly kind: string;
    readonly confidence: number;
    readonly data: Record<string, unknown>;
  }>;
}>;

export interface AutoPopulateAdapterDeps {
  readonly processChat: ProcessChatFn;
  readonly ctx: RequestContext;
  readonly turnIdFor?: (req: MdAutoPopulateRequest) => string;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

export function createAutoPopulateAdapter(
  deps: AutoPopulateAdapterDeps,
): MdAutoPopulatePort {
  const { processChat, ctx, logger } = deps;
  const turnIdFor =
    deps.turnIdFor ?? ((req) => `${ctx.correlationId}:${req.target}`);

  return Object.freeze({
    async populate(req: MdAutoPopulateRequest): Promise<MdAutoPopulateResult> {
      requireTierPolicy(ctx.tier, "md:auto_populate");
      logger?.debug("autoPopulate.populate", {
        correlationId: ctx.correlationId,
        target: req.target,
      });

      if (!req.hint || req.hint.trim().length === 0) {
        return Object.freeze({
          ok: true,
          target: req.target,
          fields: Object.freeze({}),
          provenance: Object.freeze({}),
          gaps: Object.freeze(["hint:empty"]),
        });
      }

      const out = await processChat(turnIdFor(req), req.hint, {
        orgId: req.orgId,
        userId: ctx.userId,
        tier: req.tier,
        sessionId: ctx.sessionId,
        correlationId: ctx.correlationId,
      });

      // C-3 fix: when target === "any" the orchestrator wants a
      // rollup over EVERY extracted entity (the MD's "Captured N
      // entities from your message" observation). Previously this
      // path .find()'d for kind === "any" and never matched.
      //
      // For specific targets ("employee" / "customer" / "lead" / ...),
      // keep the original behaviour: project the first matching
      // entity's fields.
      if (req.target === "any") {
        if (out.entities.length === 0) {
          return Object.freeze({
            ok: true,
            target: req.target,
            fields: Object.freeze({}),
            provenance: Object.freeze({}),
            gaps: Object.freeze(["target:any:no-entities"]),
          });
        }
        const fields: Record<string, unknown> = {};
        const provenance: Record<string, string> = {};
        for (const ent of out.entities) {
          // Namespace each entity's data under its kind so the
          // orchestrator's rollup observation can describe them as
          // distinct kinds.
          fields[ent.kind] = Object.freeze({
            confidence: ent.confidence,
            data: ent.data,
          });
          provenance[ent.kind] = "chat:auto-populate";
        }
        return Object.freeze({
          ok: true,
          target: req.target,
          fields: Object.freeze(fields),
          provenance: Object.freeze(provenance),
          gaps: Object.freeze([]),
        });
      }

      const match = out.entities.find((e) => e.kind === req.target);
      if (!match) {
        return Object.freeze({
          ok: true,
          target: req.target,
          fields: Object.freeze({}),
          provenance: Object.freeze({}),
          gaps: Object.freeze([`target:${req.target}:no-match`]),
        });
      }

      const fields = Object.fromEntries(
        Object.entries(match.data).map(([k, v]) => [k, v]),
      );
      const provenance = Object.fromEntries(
        Object.keys(match.data).map((k) => [k, "chat:auto-populate"]),
      );

      return Object.freeze({
        ok: true,
        target: req.target,
        fields: Object.freeze(fields),
        provenance: Object.freeze(provenance),
        gaps: Object.freeze([]),
      });
    },
  });
}
