/**
 * TenantBrandingService — single source of truth for the AI persona's
 * display name, avatar, and greeting register per tenant.
 *
 * Blueprint cite: Docs/PHASES_FINDINGS/phM-platform-blueprint.md §A.3 / C1
 * + C2 — today 55 `Mr. Mwikila` literals leak across 30 files. A London
 * operator cannot rebrand to "Mr. Smith"; a Seoul operator cannot
 * rebrand to "Professor Kim". This service turns every user-visible
 * occurrence into a parameterised lookup.
 *
 * Backward compat (intentional — per Wave 27 Agent E brief):
 *   - Default `aiPersonaDisplayName` → 'Borjie AI' (country-neutral).
 *   - Kenya-pilot tenants can retain 'Mr. Mwikila' by configuring their
 *     tenant branding; we also export a convenience alias
 *     `MR_MWIKILA_ALIAS` so that existing comms templates comparing to
 *     the string continue to work.
 *
 * All methods are pure — the service caches nothing. Callers that need
 * high-throughput access should memoise at their call site.
 */

/** Narrow, stable shape of a tenant as seen by the branding layer. */
export interface BrandingCapableTenant {
  readonly id: string;
  readonly name?: string | null;
  readonly countryCode?: string | null;
  /**
   * Optional tenant-scoped overrides for persona identity. Populated
   * from the `tenants.settings` JSONB (see `packages/database/src/
   * schemas/tenant.schema.ts`). When absent, the service falls back
   * to the country-neutral default.
   */
  readonly branding?: TenantBrandingOverrides | null;
}

/** Overridable pieces of the AI persona identity — all optional. */
export interface TenantBrandingOverrides {
  /** Display name shown in chat headers, letters, audit logs. */
  readonly aiPersonaDisplayName?: string;
  /** Honorific prefix (e.g. "Mr.", "Ms.", "Professor"). */
  readonly aiPersonaHonorific?: string;
  /** Spoken greeting (e.g. "Karibu", "Willkommen", "어서오세요"). */
  readonly aiGreeting?: string;
  /** Assistant pronoun — he / she / they. */
  readonly aiPronoun?: 'he' | 'she' | 'they';
}

/** Neutral defaults — NEVER Kenya-branded. */
export const DEFAULT_AI_PERSONA_DISPLAY_NAME = 'Borjie AI';
export const DEFAULT_AI_GREETING = 'Welcome';
export const DEFAULT_AI_PRONOUN: 'he' | 'she' | 'they' = 'they';

/**
 * Historical alias. Wave 27 left this in-source so that any legacy
 * comms template or audit-log matcher written against the string
 * 'Mr. Mwikila' continues to resolve for Kenya-pilot deployments.
 * New code MUST NOT compare to this constant — resolve via
 * `aiPersonaDisplayName(tenant)` and let the tenant's branding decide.
 */
export const MR_MWIKILA_ALIAS = 'Mr. Mwikila';

/**
 * Canonical resolver. Returns the tenant-configured display name, or
 * the neutral default if nothing is set. NEVER returns the Kenya-
 * specific literal unless the tenant explicitly asked for it.
 */
export function aiPersonaDisplayName(tenant: BrandingCapableTenant | null | undefined): string {
  const overridden = tenant?.branding?.aiPersonaDisplayName?.trim();
  if (overridden) return overridden;
  return DEFAULT_AI_PERSONA_DISPLAY_NAME;
}

/**
 * Full honorific-prefixed form ("Mr. Smith", "Professor Kim",
 * "Mr. Mwikila"). Falls back to the display name alone if no
 * honorific is configured.
 */
export function aiPersonaFullName(tenant: BrandingCapableTenant | null | undefined): string {
  const display = aiPersonaDisplayName(tenant);
  const honor = tenant?.branding?.aiPersonaHonorific?.trim();
  if (!honor) return display;
  return `${honor} ${display}`;
}

/** Culturally-appropriate greeting for the tenant's locale/brand. */
export function aiGreeting(tenant: BrandingCapableTenant | null | undefined): string {
  return tenant?.branding?.aiGreeting?.trim() || DEFAULT_AI_GREETING;
}

/**
 * Pronoun for the AI persona. Defaults to 'they' (gender-neutral) so we
 * never hardcode he/she into templates unless the tenant opts in.
 */
export function aiPronoun(tenant: BrandingCapableTenant | null | undefined): 'he' | 'she' | 'they' {
  return tenant?.branding?.aiPronoun ?? DEFAULT_AI_PRONOUN;
}

/**
 * Substitute every `{{ai_persona_display_name}}`, `{{ai_greeting}}`,
 * `{{ai_pronoun}}` in a template string with the tenant-resolved value.
 * Used by letter-render and notification pipelines to keep the persona
 * identity out of hand-written prompts.
 */
export function renderBrandedTemplate(
  template: string,
  tenant: BrandingCapableTenant | null | undefined,
): string {
  const displayName = aiPersonaDisplayName(tenant);
  const fullName = aiPersonaFullName(tenant);
  const greeting = aiGreeting(tenant);
  const pronoun = aiPronoun(tenant);
  return template
    .replaceAll('{{ai_persona_display_name}}', displayName)
    .replaceAll('{{ai_persona_full_name}}', fullName)
    .replaceAll('{{ai_greeting}}', greeting)
    .replaceAll('{{ai_pronoun}}', pronoun);
}
