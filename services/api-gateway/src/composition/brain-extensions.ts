/**
 * Brain extensions — module-scoped hooks used to plumb composition-root
 * services into brain-building routers that were originally written with
 * a closed factory signature.
 *
 * The brain factory in `ai-chat.router.ts` + `brain.hono.ts` is constructed
 * lazily on first request and does not take a service-registry argument.
 * Rather than retrofit each router's signature (which would ripple through
 * the entire test suite), we publish a small module-scoped setter here.
 *
 * Boot (`services/api-gateway/src/index.ts`) calls `setBrainExtraSkills()`
 * once after `buildServices()` with the org-awareness query service tool
 * AND the persona-aware tool catalog (see `registerPersonaToolHandlers`).
 * The routers call `getBrainExtraSkills()` when they construct per-tenant
 * Brains and pass the array into `createBrain({ extraSkills })`.
 *
 * Tenant isolation is preserved because every tool handler resolves
 * `context.tenant.tenantId` on every invocation.
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import {
  buildPersonaToolHandlers,
  type PersonaToolGate,
} from './brain-tools';

let extraSkills: readonly ToolHandler[] = [];

/**
 * Set the extra skills injected into every Brain created by the
 * gateway routers. Idempotent — safe to call multiple times (test
 * fixtures, hot reload).
 */
export function setBrainExtraSkills(skills: readonly ToolHandler[]): void {
  extraSkills = skills;
}

/**
 * Read the currently-registered extra skills. Returns an empty array
 * if `setBrainExtraSkills` was never called (degraded mode).
 */
export function getBrainExtraSkills(): readonly ToolHandler[] {
  return extraSkills;
}

/**
 * Append a list of skills to the existing extras. Used by composition
 * roots that wire several batches (org-awareness, persona-aware catalog,
 * future docs / draft tools) without each step having to know about the
 * others.
 */
export function appendBrainExtraSkills(
  skills: readonly ToolHandler[],
): void {
  // Immutable concat — never mutate the previous frozen array.
  extraSkills = Object.freeze([...extraSkills, ...skills]);
}

/**
 * Register the persona-aware mining / admin / shared tool catalog onto
 * the brain extras list. Returns the list of registered handlers so the
 * caller can log / count them.
 *
 * Kill-switch fail-closed: when the gate reports `killSwitchOpen` we
 * REPLACE the extras list with an empty frozen array — every persona-
 * aware tool drops out in the same call so the brain has nothing to
 * propose for the duration of the boot.
 */
export function registerPersonaToolHandlers(args: {
  readonly gate: PersonaToolGate;
  readonly mode?: 'replace' | 'append';
  readonly onDuplicate?: (toolId: string) => void;
}): readonly ToolHandler[] {
  const handlers = buildPersonaToolHandlers(args.gate, {
    onDuplicate: args.onDuplicate,
  });
  if (args.gate.killSwitchOpen) {
    // Fail-closed: empty the extras when the kill-switch is open.
    extraSkills = Object.freeze([]);
    return Object.freeze([]);
  }
  if (args.mode === 'append') {
    appendBrainExtraSkills(handlers);
  } else {
    setBrainExtraSkills(handlers);
  }
  return handlers;
}

// Re-export the gate / sink / client surfaces so the composition root
// in `index.ts` can construct them without reaching into the brain-tools
// subtree directly.
export type {
  PersonaToolGate,
  PersonaToolAuditSink,
  PersonaToolHttpClient,
} from './brain-tools';
