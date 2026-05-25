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
 * once after `buildServices()` with the org-awareness query service tool.
 * The routers call `getBrainExtraSkills()` when they construct per-tenant
 * Brains and pass the array into `createBrain({ extraSkills })`.
 *
 * Tenant isolation is preserved because every tool handler resolves
 * `context.tenant.tenantId` on every invocation.
 */

import type { ToolHandler } from '@borjie/ai-copilot';

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
