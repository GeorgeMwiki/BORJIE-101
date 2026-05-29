/**
 * Brain ← jurisdiction prompt injector — JA-2.
 *
 * Best-effort helper used by brain-teach.hono.ts + public-chat.hono.ts
 * to render the `## TENANT JURISDICTION` + `## JURISDICTION DISCLOSURE
 * RULES` blocks at the top of every system prompt.
 *
 * NEVER blocks the turn — when the resolver fails (DB unreachable,
 * tenant row missing, etc.) the function returns an empty string
 * and the brain falls back to the legacy hardcoded TZ defaults baked
 * into the base prompt. A debug log line surfaces the degradation
 * for observability but does not break the user-facing path.
 */

import { sql } from 'drizzle-orm';
import pino from 'pino';

import {
  createJurisdictionResolver,
  detectJurisdiction,
  isSeededOverride,
  renderJurisdictionPromptSection,
  type ResolvedJurisdiction,
} from '../jurisdiction-resolver/index.js';
import { createDrizzleTenantConfigService } from '../tenant-config/service.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'brain-jurisdiction-prompt',
});

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ResolveJurisdictionInput {
  readonly db: DbLike | null;
  readonly tenantId: string;
  readonly userMessage: string;
  readonly language: 'sw' | 'en';
}

export interface JurisdictionPromptResult {
  /**
   * Rendered prompt section ready to splice into the system prompt
   * just under `<owner_context>`. Empty string when the resolver
   * failed — caller falls back to the legacy hardcoded TZ default.
   */
  readonly section: string;
  /**
   * Resolved snapshot — null when resolution failed. Surfaces so
   * downstream callers (capability registry, brain tools) can reuse
   * the same snapshot without a second DB hit.
   */
  readonly resolved: ResolvedJurisdiction | null;
  /**
   * The detected override (if any). Forwarded so callers can decide
   * whether to surface a "answering for KE this turn" badge to the UI.
   */
  readonly detectedOverride: string | null;
}

/**
 * Resolve the tenant's jurisdiction + render the prompt section.
 *
 * Best-effort: returns `{section: '', resolved: null}` when the DB
 * is unavailable. The brain prompt still works in that case — the
 * legacy hardcoded TZ defaults inside the base prompt take over.
 */
export async function resolveJurisdictionForPrompt(
  input: ResolveJurisdictionInput,
): Promise<JurisdictionPromptResult> {
  const { db, tenantId, userMessage, language } = input;
  if (!db) {
    return Object.freeze({ section: '', resolved: null, detectedOverride: null });
  }
  let detectedOverride: string | null = null;
  try {
    detectedOverride = detectJurisdiction(userMessage);
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err) },
      'jurisdiction detector failed — continuing with default path',
    );
  }
  // Brain owns the rule per the JA-2 spec: only honor a detected
  // override when it points at a seeded jurisdiction OR is a clear
  // unseeded country mention (so the brain can offer the graceful
  // "I don't have details wired yet" copy). For unseeded cases we
  // still pass the override so the resolver's source flag flips to
  // 'unseeded' and the prompt block carries that signal.
  const overrideToApply =
    detectedOverride && (isSeededOverride(detectedOverride) || true)
      ? detectedOverride
      : null;

  try {
    const tenantConfig = createDrizzleTenantConfigService(
      db as unknown as { execute(q: unknown): Promise<unknown> },
    );
    const resolver = createJurisdictionResolver({ tenantConfig });
    const resolved = await resolver.resolve(tenantId, overrideToApply);
    const section = renderJurisdictionPromptSection(resolved, { language });
    return Object.freeze({
      section,
      resolved,
      detectedOverride: overrideToApply,
    });
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), tenantId },
      'jurisdiction resolver failed — falling back to legacy TZ defaults',
    );
    return Object.freeze({ section: '', resolved: null, detectedOverride: null });
  }
}

/**
 * Re-export the sql helper so callers that want to write integration
 * tests can mock the db.execute interface without pulling drizzle.
 */
export { sql };
