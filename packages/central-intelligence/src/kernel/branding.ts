/**
 * Persona branding — per-tenant overrides for the kernel persona.
 *
 * Each tenant (often an agency) can customise:
 *   - displayName       → what the AI calls itself in that tenant's UI
 *   - openingPreamble   → a short phrase prepended to the opening line
 *                          (e.g. "Welcome to Acme Estates")
 *   - voiceProfileId    → the voice-bridge profile id used when the
 *                          voice surface speaks (e.g. a calmer voice
 *                          for a luxury brand). NOT applied here; the
 *                          voice-bridge picks it up separately.
 *
 * The override is applied IMMUTABLY: a fresh PersonaIdentity is
 * returned and the base persona is left untouched. This keeps the
 * surface-default personas in `identity.ts` truly constant and allows
 * the same kernel to serve many tenants without cross-contamination.
 *
 * Mirrors LITFIN's bank-snapshot configuration pattern: a small set of
 * tenant-scoped knobs that re-skin the AI without replacing its
 * underlying voice rules (toneGuidance, taboos, violationSignals,
 * firstPersonNoun all flow through unchanged).
 */

import type { PersonaIdentity } from './identity.js';

// ─────────────────────────────────────────────────────────────────────
// PersonaBrandingOverride — the wire shape an agency configures.
// ─────────────────────────────────────────────────────────────────────

export interface PersonaBrandingOverride {
  /** When set, replaces the persona's displayName. */
  readonly displayName?: string;
  /** When set, prepended to the opening statement, separated by " — ". */
  readonly openingPreamble?: string;
  /**
   * Optional voice-profile id used by the voice-bridge when the kernel
   * is speaking on a voice surface. Not consumed by the prompt
   * pipeline directly; left in the override shape so the voice-bridge
   * can resolve it from the same per-tenant lookup.
   */
  readonly voiceProfileId?: string;
}

// ─────────────────────────────────────────────────────────────────────
// applyBrandingOverride — returns a new PersonaIdentity with the
// override applied. Pure / immutable — never mutates the base.
// ─────────────────────────────────────────────────────────────────────

export function applyBrandingOverride(
  base: PersonaIdentity,
  override: PersonaBrandingOverride | null | undefined,
): PersonaIdentity {
  if (!override) return base;

  const trimmedDisplayName =
    typeof override.displayName === 'string' ? override.displayName.trim() : '';
  const trimmedPreamble =
    typeof override.openingPreamble === 'string' ? override.openingPreamble.trim() : '';

  if (!trimmedDisplayName && !trimmedPreamble) return base;

  return {
    ...base,
    displayName: trimmedDisplayName ? trimmedDisplayName : base.displayName,
    openingStatement: trimmedPreamble
      ? `${trimmedPreamble} — ${base.openingStatement}`
      : base.openingStatement,
  };
}

// ─────────────────────────────────────────────────────────────────────
// PersonaBrandingResolver — port supplied by the composition root so
// the kernel can look up an override per (tenantId, surface). Tests use
// the in-memory implementation below; production wires a Drizzle-backed
// service from @borjie/database.
// ─────────────────────────────────────────────────────────────────────

export interface PersonaBrandingResolver {
  resolve(args: {
    readonly tenantId: string | null;
    readonly surface: string;
  }): Promise<PersonaBrandingOverride | null>;
}

/**
 * In-memory resolver — for tests and dev. Keys may be either the
 * surface-specific form `${tenantId}::${surface}` or the surface-
 * agnostic form `${tenantId}`. The resolver tries the specific key
 * first and falls back to the surface-agnostic key if no match.
 *
 * Returns null when:
 *   - tenantId is null (platform-tier requests)
 *   - no key matches in either form
 */
export function createInMemoryPersonaBrandingResolver(
  table: ReadonlyMap<string, PersonaBrandingOverride>,
): PersonaBrandingResolver {
  return {
    async resolve({ tenantId, surface }) {
      if (!tenantId) return null;
      const specific = table.get(`${tenantId}::${surface}`);
      if (specific) return specific;
      const fallback = table.get(tenantId);
      return fallback ?? null;
    },
  };
}
