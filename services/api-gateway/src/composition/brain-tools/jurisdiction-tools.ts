/**
 * Jurisdiction brain tools — JA-4 (+JA-5 deprecated, see notes).
 *
 *   - `mwikila.jurisdiction.show_current` (JA-4)
 *        Returns a formatted bilingual snapshot of the tenant's
 *        jurisdiction (country, named regulators, currency, language,
 *        time zone) plus a bilingual sw/en offer to switch context.
 *        LOW stakes, READ-only, persona-gated to owner + admin.
 *
 *   - `mwikila.jurisdiction.switch` (JA-5 ORIGINAL)
 *        The original JA spec called for a switch tool here. It has
 *        since been SUPERSEDED by `mwikila.jurisdiction.switch` in
 *        the JC-6 catalog (services/api-gateway/src/composition/
 *        brain-tools/jurisdiction-discovery-tools.ts) which now
 *        owns the canonical contract:
 *           - `scope: 'turn' | 'session'` only;
 *           - `permanent` change is REJECTED — tenant.jurisdiction
 *             is LOCKED at signup per migration 0149, and changes
 *             go through the Borjie internal admin surface (JC-7).
 *        We do NOT re-register the switch id here to avoid a
 *        duplicate-id warning in `mergeDescriptors`.
 *
 * Composition root: registered through brain-tools/index.ts so the
 * persona-runtime ToolDispatcher discovers the show-current tool at
 * boot.
 */

import { z } from 'zod';

import {
  createJurisdictionResolver,
  type ResolvedJurisdiction,
} from '../../services/jurisdiction-resolver/index.js';
import { createDrizzleTenantConfigService } from '../../services/tenant-config/service.js';
import { getDb } from '../db-client.js';
import type { PersonaToolDescriptor } from './types.js';

const OWNER_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ─────────────────────────────────────────────────────────────────────
// JA-4 — mwikila.jurisdiction.show_current
// ─────────────────────────────────────────────────────────────────────

const ShowCurrentInput = z.object({
  language: z.enum(['en', 'sw']).optional().default('en'),
});

const ShowCurrentOutput = z.object({
  country: z.string(),
  countryName: z.string(),
  currency: z.string(),
  defaultLanguage: z.string(),
  locale: z.string(),
  timeZone: z.string(),
  mineralAuthority: z.string(),
  environmentalAuthority: z.string(),
  transparencyInitiative: z.string(),
  auditAuthority: z.string(),
  formattedEn: z.string(),
  formattedSw: z.string(),
  source: z.enum(['tenant', 'override', 'unseeded']),
});

async function resolveTenantJurisdiction(
  tenantId: string,
): Promise<ResolvedJurisdiction> {
  const db = getDb();
  if (!db) {
    throw new Error('jurisdiction-tools: database unavailable');
  }
  const tenantConfig = createDrizzleTenantConfigService(
    db as unknown as { execute(q: unknown): Promise<unknown> },
  );
  const resolver = createJurisdictionResolver({ tenantConfig });
  return resolver.resolve(tenantId);
}

/**
 * Render the bilingual user-facing snapshot. Both languages are
 * always returned so the brain orchestrator can pick the right one
 * (or render both side-by-side for sw-primary tenants who want EN
 * confirmation).
 */
function renderShowCurrent(
  resolved: ResolvedJurisdiction,
): { formattedEn: string; formattedSw: string } {
  const regulatorListEn = [
    resolved.mineralAuthorities.mineralAuthority,
    resolved.environmentalAuthority,
    resolved.transparencyInitiative,
    resolved.auditAuthority,
  ].join(', ');

  const formattedEn = `Your operation is in ${resolved.country} (${resolved.countryName}). Regulators: ${regulatorListEn}. Currency: ${resolved.currency}. Default language: ${resolved.defaultLanguage}. Want to switch context for this conversation? Say e.g. "in Kenya, ..." for a one-turn answer, or call mwikila.jurisdiction.switch with scope:'session' for the whole chat.`;

  const formattedSw = `Mgodi wako uko ${resolved.country} (${resolved.countryName}). Wadhibiti: ${regulatorListEn}. Sarafu: ${resolved.currency}. Lugha chaguo-msingi: ${resolved.defaultLanguage}. Unataka kubadili eneo kwa mazungumzo haya? Sema kwa mfano "in Kenya, ..." kwa zamu moja, au tumia mwikila.jurisdiction.switch (scope:'session') kwa mazungumzo yote.`;

  return { formattedEn, formattedSw };
}

export const jurisdictionShowCurrentTool: PersonaToolDescriptor<
  typeof ShowCurrentInput,
  typeof ShowCurrentOutput
> = {
  id: 'mwikila.jurisdiction.show_current',
  name: 'Jurisdiction — show current',
  description:
    'Return the tenant\'s current jurisdiction snapshot — country, named regulators ' +
    "(mineral / environmental / transparency / audit), currency, default language, " +
    'time zone — plus a bilingual sw/en offer to switch context for the current conversation. ' +
    'Use when the owner asks "what jurisdiction am I in", "which regulators apply", ' +
    '"what currency are we using", or any equivalent localisation question. READ-only, ' +
    'LOW stakes, persona-gated to owner + admin. Companion to mwikila.jurisdiction.switch ' +
    "(JC-6) for actually applying an override.",
  personaSlugs: OWNER_ADMIN,
  inputSchema: ShowCurrentInput,
  outputSchema: ShowCurrentOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    void input;
    const resolved = await resolveTenantJurisdiction(ctx.tenantId);
    const { formattedEn, formattedSw } = renderShowCurrent(resolved);
    return {
      country: resolved.country,
      countryName: resolved.countryName,
      currency: resolved.currency,
      defaultLanguage: resolved.defaultLanguage,
      locale: resolved.locale,
      timeZone: resolved.timeZone,
      mineralAuthority: resolved.mineralAuthorities.mineralAuthority,
      environmentalAuthority: resolved.environmentalAuthority,
      transparencyInitiative: resolved.transparencyInitiative,
      auditAuthority: resolved.auditAuthority,
      formattedEn,
      formattedSw,
      source: resolved.source,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalogue export
// ─────────────────────────────────────────────────────────────────────

export const JURISDICTION_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  jurisdictionShowCurrentTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
