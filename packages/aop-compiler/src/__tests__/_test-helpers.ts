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
  // arrears-chase
  'tenant.send_reminder': 'write',
  'tenant.voice_call': 'write',
  'notice.draft_eviction_notice': 'destructive',
  // lease-renewal
  'lease.draft_renewal': 'write',
  'lease.send_to_tenant': 'write',
  'lease.record_signature': 'write',
  // kra-filing — note: filing is `write` not `destructive`. Filings can be
  // amended; they are not legally irreversible the way an eviction is. Keep
  // this distinction precise so the destructive-guard rule remains tight.
  'kra.compile_mri_batch': 'read',
  'kra.file_via_mcp': 'write',
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
