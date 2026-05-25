/**
 * Piece L — Accept-proposal handler registry.
 *
 * Module template handlers (ESTATE, LITFIN, MAINTENANCE, ...) live on
 * Piece B's `claude/piece-b-dynamic-modules` branch. Until that merges,
 * this stub registry logs the would-be call and returns a successful
 * "stub" response so the dispatcher's accept_proposal path is
 * exercisable end-to-end.
 *
 * When Piece B lands, the api-gateway composition root replaces the
 * stub registry with a real one that dispatches to the concrete handler
 * implementations in `packages/module-templates/`.
 */

import type {
  AcceptHandler,
  AcceptHandlerArgs,
  AcceptHandlerRegistry,
  AcceptHandlerResult,
} from './types.js';

export interface StubHandlerOptions {
  /**
   * Per-action handlers that override the default stub. Useful in tests
   * to simulate handler failures or to assert on payload shape.
   */
  readonly overrides?: Readonly<Record<string, AcceptHandler>>;
  /**
   * Optional logger sink — defaults to a no-op so tests stay quiet.
   * Production wiring provides a pino-based logger.
   */
  readonly log?: (msg: string, ctx: Record<string, unknown>) => void;
}

/**
 * Build a stub registry. Records every invocation so tests can assert
 * on the captured payload.
 */
export function createStubHandlerRegistry(
  opts: StubHandlerOptions = {},
): AcceptHandlerRegistry & {
  readonly invocations: ReadonlyArray<AcceptHandlerArgs>;
} {
  const log =
    opts.log ??
    ((_msg: string, _ctx: Record<string, unknown>) => {
      /* no-op */
    });
  const invocations: AcceptHandlerArgs[] = [];

  const defaultHandler: AcceptHandler = async (args) => {
    log('stub_handler.invoke', {
      tenant_id: args.tenant_id,
      module_template_id: args.proposal.module_template_id,
      action: args.proposal.action,
      proposal_id: args.proposal.id,
    });
    invocations.push(args);
    return {
      ok: true,
      artifacts: [
        {
          type: `${args.proposal.module_template_id.toLowerCase()}_record`,
          id: `stub_${args.proposal.action}_${args.proposal.id}`,
        },
      ],
    } satisfies AcceptHandlerResult;
  };

  return {
    get(moduleTemplateId, action) {
      const key = `${moduleTemplateId}.${action}`;
      return opts.overrides?.[key] ?? defaultHandler;
    },
    listInvocations() {
      return [...invocations];
    },
    get invocations() {
      return invocations;
    },
  };
}
