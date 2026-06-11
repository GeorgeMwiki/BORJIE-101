/**
 * Jurisdiction-discovery brain tools — JC-1 + JC-6.
 *
 * Companion to:
 *   - services/api-gateway/src/services/jurisdiction-discovery/
 *   - services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts
 *   - packages/database/src/migrations/0148_discovered_jurisdictions.sql
 *   - packages/database/src/migrations/0149_lock_tenant_jurisdiction.sql
 *
 * Catalogue:
 *   - mwikila.jurisdiction.discover   — JC-1, on-demand jurisdiction lookup.
 *                                       Mr. Mwikila NEVER says "I don't know"
 *                                       — instead he calls this tool and
 *                                       answers from the discovered profile.
 *   - mwikila.jurisdiction.switch     — JC-6, per-turn / per-session override.
 *                                       NEVER 'permanent' — that path is owned
 *                                       by Borjie internal admin (JC-7).
 *
 * Persona scope: every persona can ask about a jurisdiction. The
 * switch tool is also persona-wide but its `scope` enum is restricted
 * to 'turn' | 'session' — 'permanent' is rejected at validation time
 * with a bilingual sw/en message pointing the user at support.
 */

import { z } from 'zod';

import { PERSONA_SLUGS, type PersonaToolDescriptor } from './types.js';

const ALL_PERSONAS = PERSONA_SLUGS;

// ─── Schemas ──────────────────────────────────────────────────────────

const DiscoverInput = z.object({
  /** ISO-3166-1 alpha-2 code or English country name (e.g. "PE", "Peru"). */
  country: z.string().min(2).max(60),
});

const DiscoveredRegulatorSchema = z.object({
  name: z.string(),
  domain: z.enum([
    'mineral_licensing',
    'environment',
    'transparency',
    'audit',
    'unknown',
  ]),
  mandate: z.string().optional(),
  url: z.string().optional(),
});

const DiscoverySourceSchema = z.object({
  kind: z.enum(['web_search', 'corpus', 'fallback']),
  id: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
});

const DiscoverOutput = z.object({
  countryCode: z.string(),
  countryName: z.string(),
  regulators: z.array(DiscoveredRegulatorSchema),
  currency: z.string(),
  languages: z.array(z.string()),
  legalFramework: z.string().optional(),
  validityScore: z.number().min(0).max(1),
  origin: z.enum(['seed', 'cache', 'discovered', 'fallback']),
  lowConfidence: z.boolean(),
  sources: z.array(DiscoverySourceSchema),
  /** Promotion hint surfaced to the user-facing answer. */
  promotionHint: z.string(),
});

// JC-6 — 'permanent' is INTENTIONALLY excluded from the enum so the
// validator rejects it at the door. The tool description states the
// rule explicitly so the LLM knows not to attempt it.
const SwitchInput = z.object({
  countryCode: z
    .string()
    .min(2)
    .max(2)
    .regex(/^[A-Z]{2}$/u, 'countryCode must be ISO-3166-1 alpha-2'),
  scope: z.enum(['turn', 'session']),
});

const SwitchOutput = z.object({
  acknowledged: z.literal(true),
  countryCode: z.string(),
  scope: z.enum(['turn', 'session']),
  message: z.object({
    en: z.string(),
    sw: z.string(),
  }),
});

// ─── Descriptors ──────────────────────────────────────────────────────

export const jurisdictionDiscoverTool: PersonaToolDescriptor<
  typeof DiscoverInput,
  typeof DiscoverOutput
> = {
  id: 'mwikila.jurisdiction.discover',
  name: 'Discover a jurisdiction (web + corpus + seed)',
  description:
    'On-demand jurisdiction lookup. Use this WHENEVER the user asks about ' +
    "a country we have not seeded — Mr. Mwikila NEVER says \"I don't know\"" +
    ' about a country. Pass the country (alpha-2 like "PE" or name like ' +
    '"Peru"). Returns regulators, currency, language, legal framework, ' +
    'validity score, and source citations. ALWAYS cite the returned ' +
    'sources in the user-facing reply.',
  personaSlugs: ALL_PERSONAS,
  inputSchema: DiscoverInput,
  outputSchema: DiscoverOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      // Loopback unavailable — return a low-confidence stub so the
      // brain still has structure to render. Mr. Mwikila NEVER says
      // "I don't know"; the prompt section signals the gap explicitly.
      const code = input.country.trim().slice(0, 2).toUpperCase();
      return {
        countryCode: code || 'XX',
        countryName: input.country,
        regulators: [
          {
            name: `${input.country} regulator (best-effort)`,
            domain: 'mineral_licensing' as const,
          },
        ],
        currency: 'UNKNOWN',
        languages: ['en'],
        validityScore: 0.2,
        origin: 'fallback' as const,
        lowConfidence: true,
        sources: [],
        promotionHint:
          'Discovery is degraded — once the system reconnects to the web/corpus probes I can ' +
          'verify these details and offer to permanently add this jurisdiction (requires Borjie ' +
          'internal admin approval).',
      };
    }
    // Use the output schema as the single source of truth for the wire
    // shape. The previous hand-written generic used ReadonlyArray<…> which
    // is not assignable to the mutable arrays `z.infer<DiscoverOutput>`
    // produces — the descriptor's declared handler return type.
    return client.post<z.infer<typeof DiscoverOutput>>(
      '/internal/jurisdiction-discovery/discover',
      {
        tenantId: ctx.tenantId,
        country: input.country,
      },
    );
  },
};

export const jurisdictionSwitchTool: PersonaToolDescriptor<
  typeof SwitchInput,
  typeof SwitchOutput
> = {
  id: 'mwikila.jurisdiction.switch',
  name: 'Switch jurisdiction context for this turn or session',
  description:
    'Apply a jurisdiction override for the CURRENT turn or chat session ' +
    'only. Use when the user explicitly mentions another country ' +
    '("for our Uganda operation"). NEVER pass scope="permanent" — the ' +
    'tenant\'s jurisdiction is LOCKED at signup and only Borjie internal ' +
    'admin can change it (JC-7). If the user asks to switch permanently, ' +
    'respond bilingually that the change requires Borjie support, then ' +
    'offer to draft the request.',
  personaSlugs: ALL_PERSONAS,
  inputSchema: SwitchInput,
  outputSchema: SwitchOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, _ctx) {
    // No remote call — the override is purely a brain-side context flag
    // surfaced back to the orchestrator. The output payload teaches the
    // model how to phrase the bilingual confirmation.
    const sw =
      input.scope === 'turn'
        ? `Sawa — nitatumia muktadha wa ${input.countryCode} kwa swali hili tu.`
        : `Sawa — nitatumia muktadha wa ${input.countryCode} kwa mazungumzo haya yote, lakini akaunti yako bado imefungwa kwa nchi yake ya usajili.`;
    const en =
      input.scope === 'turn'
        ? `Got it — applying the ${input.countryCode} context for THIS question only.`
        : `Got it — using ${input.countryCode} context for this conversation, but your account remains locked to its signup jurisdiction.`;
    return {
      acknowledged: true as const,
      countryCode: input.countryCode,
      scope: input.scope,
      message: { en, sw },
    };
  },
};

// ─── JC-7b: promote a learned country into the launch market ──────────
// Admin-only, HIGH-risk, write. This is the generative "unlock a new market"
// action: once the MD has DISCOVERED a jurisdiction + the admin has ingested
// its compliance corpus, this promotes the country into `enabled_countries`
// (migration 0337) so users can select it at signup. TZ is the only seeded
// market; every other unlock flows through here under governance.
const PromoteInput = z.object({
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2,3}$/)
    .describe('ISO-3166-1 alpha-2 code of the country to unlock (e.g. "US").'),
  countryName: z.string().min(1),
  currencyCode: z.string().min(3).max(3).optional(),
  learnedFromCorpus: z
    .boolean()
    .optional()
    .describe('TRUE if the country was learned from ingested compliance docs.'),
  evidence: z.string().optional().describe('Why this market is ready to unlock.'),
});
const PromoteOutput = z.object({
  enabled: z.boolean(),
  country: z.record(z.any()),
});

export const jurisdictionPromoteTool: PersonaToolDescriptor<
  typeof PromoteInput,
  typeof PromoteOutput
> = {
  id: 'mwikila.jurisdiction.promote',
  name: 'Unlock a country for signup (promote learned jurisdiction)',
  description:
    'Promote a LEARNED jurisdiction into the launch market so users can select ' +
    'it at signup. Use ONLY after the country has been discovered and its ' +
    'compliance corpus ingested. HIGH-risk, platform-admin only — adds a row to ' +
    'the enabled_countries registry (jurisdiction is data, never code).',
  personaSlugs: ['T2_admin_strategist'],
  inputSchema: PromoteInput,
  outputSchema: PromoteOutput,
  stakes: 'HIGH',
  isWrite: true,
  // HIGH-risk policy prefix — opening a new market must hit literal policy rules.
  requiresPolicyRuleLiteral: true,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) throw new Error('mwikila.jurisdiction.promote requires httpClient');
    return client.post<z.infer<typeof PromoteOutput>>(
      `/admin/jurisdictions/${input.countryCode}/enable`,
      {
        name: input.countryName,
        ...(input.currencyCode ? { currencyCode: input.currencyCode } : {}),
        ...(input.learnedFromCorpus !== undefined
          ? { learnedFromCorpus: input.learnedFromCorpus }
          : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
      },
    );
  },
};

export const JURISDICTION_DISCOVERY_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  jurisdictionDiscoverTool,
  jurisdictionSwitchTool,
  jurisdictionPromoteTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
