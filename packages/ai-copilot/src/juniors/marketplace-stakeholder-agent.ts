/**
 * Marketplace / External-Stakeholder Window Agent — dual-direction
 * discovery (sellers ↔ buyers), listings + ratings, AI-translated
 * communication (AGENT_PROMPT_LIBRARY §22).
 *
 * Schema gap: `marketplace_listings` raw SQL; TODO(phase-3).
 */

import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';

export const ParticipantKind = z.enum([
  'tenant_seller',
  'external_buyer',
  'worker',
  'equipment_owner',
  'lab',
  'expert',
  'transporter',
  'cooperative',
]);

export const MarketplaceInputSchema = z.object({
  tenantId: z.string().min(1),
  mode: z.enum(['discovery', 'list', 'rate']),
  query: z.string().min(1),
  participant_kind: ParticipantKind,
  language: z.enum(['sw', 'en', 'fr', 'zh']).default('sw'),
  geography: z.string().optional(),
  rating_payload: z
    .object({
      ratee_id: z.string(),
      stars: z.number().int().min(1).max(5),
      comment: z.string().optional(),
    })
    .optional(),
  listing_payload: z
    .object({
      title: z.string(),
      description: z.string(),
      mineral: z.string().optional(),
      quantity: z.number().nonnegative().optional(),
      unit: z.string().optional(),
      price_tzs: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type MarketplaceInput = z.infer<typeof MarketplaceInputSchema>;

export const MarketplaceOutput = AuditedOutputBase.extend({
  mode: z.enum(['discovery', 'list', 'rate']),
  results: z.array(
    z.object({
      id: z.string(),
      kind: ParticipantKind,
      title: z.string(),
      summary: z.string(),
      rating_avg: z.number().min(0).max(5).optional(),
      kyc_status: z.enum(['verified', 'pending', 'unverified']),
    }),
  ),
  listing_id: z.string().optional(),
  rating_id: z.string().optional(),
  translated_message: z
    .object({ from: z.string(), to: z.string(), text: z.string() })
    .optional(),
});
export type MarketplaceOutput = z.infer<typeof MarketplaceOutput>;

export const MARKETPLACE_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Marketplace / External-Stakeholder Window Agent',
  mandate:
    'Operate the dual-direction marketplace: externals view local performance, locals view external partner opportunities. Manage listings, ratings, and AI-translated communication (Swahili ↔ EN ↔ FR ↔ ZH).',
  tools: 'search_marketplace, create_listing, post_rating, translate_message, kyc_lookup.',
  evidence:
    'Cite the KYC reference for every external party. Cite the dispute-resolution stage for every contested rating.',
  outputSchema:
    '{ "mode": "discovery"|"list"|"rate", "results": [...], "listing_id"?: string, "rating_id"?: string, ' +
    '"translated_message"?: {...}, "confidence": number, "rationale": string, ' +
    '"evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.65,
  autonomyDomain: 'marketplace operations; never exposes LMBM data without explicit owner opt-in per data class',
  hardRules: [
    'KYC required for any external party listing (route to buyer-kyc-agent if missing).',
    'Mediation step required before any rating becomes permanent.',
    'No public exposure of LMBM data without explicit owner opt-in per data class.',
    'Group co-listings allowed for cooperatives.',
  ],
});

function buildUserPrompt(input: MarketplaceInput): string {
  return [
    `TENANT: ${input.tenantId}  MODE: ${input.mode}  LANG: ${input.language}  KIND: ${input.participant_kind}`,
    input.geography ? `GEO: ${input.geography}` : '',
    `QUERY: ${input.query}`,
    input.listing_payload ? `LISTING_PAYLOAD: ${JSON.stringify(input.listing_payload)}` : '',
    input.rating_payload ? `RATING_PAYLOAD: ${JSON.stringify(input.rating_payload)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createMarketplaceStakeholderAgent(deps: JuniorDeps) {
  return {
    async processInput(input: MarketplaceInput): Promise<MarketplaceOutput> {
      const validated = MarketplaceInputSchema.parse(input);
      const output = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'marketplace-stakeholder-agent',
        schema: MarketplaceOutput,
        systemPrompt: MARKETPLACE_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated),
        maxTokens: 2200,
      });

      if (deps.db && validated.mode === 'list') {
        try {
          const { sql } = await import('drizzle-orm');
          const payload = JSON.stringify(validated.listing_payload ?? {});
          // TODO(phase-3): typed insert against `marketplace_listings`.
          await deps.db.execute(
            sql`INSERT INTO marketplace_listings
                  (id, tenant_id, participant_kind, payload, created_at)
                VALUES (gen_random_uuid(), ${validated.tenantId}, ${validated.participant_kind},
                        ${payload}::jsonb, NOW())
                ON CONFLICT DO NOTHING`,
          );
        } catch (err) {
          deps.logger?.warn('marketplace-stakeholder-agent: db write skipped', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      return output;
    },
  };
}
export type MarketplaceStakeholderAgent = ReturnType<typeof createMarketplaceStakeholderAgent>;

export function createDefaultMarketplaceStakeholderAgent(): MarketplaceStakeholderAgent {
  let cached: MarketplaceStakeholderAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createMarketplaceStakeholderAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
