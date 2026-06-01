/**
 * Shared test helpers. A fake BrainToolRegistry and a fake LLMRouter so the
 * tests are fully deterministic and offline.
 */

import type { BrainToolRegistry, LLMRouter, ToolTier, AOP } from '../types.js';

export function buildRegistry(
  tools: Record<string, ToolTier> = {},
): BrainToolRegistry {
  return {
    has: (id) => Object.prototype.hasOwnProperty.call(tools, id),
    tier: (id) => tools[id],
  };
}

export const FIXTURE_TOOLS: Record<string, ToolTier> = {
  // royalty-arrears-chase
  'buyer.send_reminder': 'write',
  'buyer.voice_call': 'write',
  'notice.draft_supply_suspension': 'destructive',
  // offtake-renewal
  'offtake.draft_renewal': 'write',
  'offtake.send_to_buyer': 'write',
  'offtake.record_signature': 'write',
  // tra-filing — note: filing is `write` not `destructive`. Royalty returns
  // can be amended; they are not legally irreversible the way a supply
  // suspension is. Keep this distinction precise so the destructive-guard
  // rule remains tight.
  'tra.compile_royalty_return': 'read',
  'tra.file_via_mcp': 'write',
  'owner.notify': 'write',
};

/**
 * A stub LLM that maps a fixed input -> a fixed JSON string. Used by parser
 * tests to assert that NL -> AST works without actually running a model.
 */
export function buildStubLLM(
  responses: ReadonlyArray<{ contains: string; respond: AOP | string }>,
): LLMRouter {
  return {
    complete: async ({ user }) => {
      for (const r of responses) {
        if (user.includes(r.contains)) {
          return typeof r.respond === 'string' ? r.respond : JSON.stringify(r.respond);
        }
      }
      throw new Error(`stub LLM had no response for prompt: ${user.slice(0, 80)}...`);
    },
  };
}
