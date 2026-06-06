/**
 * AI-native (Agent PhL) services wiring.
 *
 * The `/ai-native` router reads four advertised PhL capabilities off
 * `services.aiNative`:
 *
 *   - `dynamicPricing`        — mineral-commodity price proposer
 *   - `docIntelligence` (+ `docIntelligenceRepo`) — mining-document entity
 *                               + obligation extraction
 *   - `legalDrafter`   (+ `legalDraftRepo`)        — mining-contract drafter
 *   - `voiceAgent`            — voice-first conversational agent
 *
 * Until now `services.aiNative` was never populated, so all four endpoints
 * returned `503 ADAPTER_NOT_CONFIGURED`. This factory wires every capability
 * to its REAL backing in `@borjie/ai-copilot/ai-native` (the PhL namespaces
 * `DynamicPricing`, `DocIntelligence`, `LegalDrafter`, `VoiceAgent`), driven
 * by:
 *   - REAL Anthropic LLM calls via the composition root's per-tenant
 *     budget-guarded client (`buildBudgetGuardedAnthropicClient`),
 *   - REAL jurisdiction law from `@borjie/compliance-plugins`
 *     (`getCountryPlugin(...).miningLaw`) for the price-control cap and the
 *     legal-drafter clause/notice dispatch,
 *   - REAL Drizzle `voice_turns` persistence (`createVoiceTurnsService`) for
 *     the voice agent.
 *
 * Persistence note: doc-intelligence entities/obligations, price
 * recommendations, and legal drafts have NO active Drizzle table in
 * `@borjie/database` (they live only in the archived BossNyumba migrations).
 * Those three repos are therefore in-process, tenant-scoped, and explicitly
 * documented as the durability gap (`ai-native/in-memory-repos.ts`). The
 * voice agent's persistence IS durable (Drizzle).
 *
 * Degradation: when no Anthropic key is configured (`buildAnthropicClient`
 * is null), the three LLM-backed capabilities are omitted so the route falls
 * back to its `503 ADAPTER_NOT_CONFIGURED` reason — never a crash. The voice
 * agent always wires (degraded brain stub when no kernel).
 *
 * No `process.env` access — the API key, model, ledger, and db all arrive as
 * injected deps bound at the composition root.
 */

import {
  DynamicPricing as DynamicPricingNs,
  DocIntelligence as DocIntelligenceNs,
  LegalDrafter as LegalDrafterNs,
} from '@borjie/ai-copilot/ai-native';

import {
  createVoiceAgentWiring,
  type VoiceAgentWiring,
  type KernelThinkFn,
} from './voice-agent-wiring.js';

import type { GuardedAnthropicFactory } from './ai-native/llm-client.js';
import { createPricingLlmPort } from './ai-native/pricing-llm-port.js';
import { createDocIntelligenceLlmPort } from './ai-native/doc-intelligence-llm-port.js';
import { createLegalDrafterLlmPort } from './ai-native/legal-drafter-llm-port.js';
import {
  createPriceControlLookup,
  createLegalLawDispatchPort,
} from './ai-native/jurisdiction-lookups.js';
import {
  createInMemoryDocIntelligenceRepo,
  createInMemoryPriceRecommendationRepo,
  createInMemoryLegalDraftRepo,
} from './ai-native/in-memory-repos.js';
import {
  createDynamicPricingRouteService,
  createDocIntelligenceRouteService,
  createLegalDrafterRouteService,
  type BudgetAsserter,
  type DynamicPricingRouteService,
  type DocIntelligenceRouteService,
  type LegalDrafterRouteService,
} from './ai-native/route-adapters.js';

type DocIntelligenceRepository = DocIntelligenceNs.DocIntelligenceRepository;
type LegalDraftRepository = LegalDrafterNs.LegalDraftRepository;

/**
 * Voice agent slice the route consumes: `aiNative.voiceAgent.turn(...)`
 * returns the PhL `AiNativeResult<VoiceTurnResult>`. Matches the `.agent`
 * member of `VoiceAgentWiring`.
 */
type VoiceAgentSlice = VoiceAgentWiring['agent'];

/** Minimal db handle — duck-typed so this file never hard-imports the DB
 *  package's `DatabaseClient` type (mirrors `voice-agent-wiring.ts`). */
type DatabaseClientLike = Parameters<typeof createVoiceAgentWiring>[0]['db'];

export interface AiNativeWiringDeps {
  /** Drizzle client (voice_turns persistence). Null → voice agent omitted. */
  readonly db: DatabaseClientLike;
  /**
   * Per-tenant budget-guarded Anthropic client factory — the composition
   * root's `buildBudgetGuardedAnthropicClient`. Null when no
   * `ANTHROPIC_API_KEY` is set; the three LLM-backed capabilities are then
   * omitted (route degrades to 503).
   */
  readonly buildAnthropicClient: GuardedAnthropicFactory | null;
  /**
   * AI cost ledger — used for the pre-flight `BUDGET_EXCEEDED` (402) check.
   * Null → the pre-flight is a no-op (the guarded client still enforces).
   */
  readonly ledger: BudgetAsserter | null;
  /**
   * Optional pre-built voice-agent wiring from the composition root (the
   * registry already constructs one with the brain kernel). When provided,
   * it is reused verbatim. When omitted, a voice agent is built here from
   * `db` + optional `kernelThink`.
   */
  readonly voiceAgentWiring?: VoiceAgentWiring | null;
  /** Optional kernel-think reference, only used when building the voice
   *  agent locally (ignored when `voiceAgentWiring` is supplied). */
  readonly kernelThink?: KernelThinkFn | null;
}

/**
 * The exact object the route reads off `services.aiNative`. Each member may
 * be absent (route returns its capability-specific 503). The repos are
 * separate members because the route's read endpoints pull
 * `docIntelligenceRepo` / `legalDraftRepo` directly.
 */
export interface AiNativeServices {
  readonly dynamicPricing?: DynamicPricingRouteService;
  readonly docIntelligence?: DocIntelligenceRouteService;
  readonly docIntelligenceRepo?: DocIntelligenceRepository;
  readonly legalDrafter?: LegalDrafterRouteService;
  readonly legalDraftRepo?: LegalDraftRepository;
  readonly voiceAgent?: VoiceAgentSlice;
}

/**
 * Build the `services.aiNative` object. Pure on top of the injected deps.
 */
export function buildAiNativeServices(
  deps: AiNativeWiringDeps,
): AiNativeServices {
  const services: {
    dynamicPricing?: DynamicPricingRouteService;
    docIntelligence?: DocIntelligenceRouteService;
    docIntelligenceRepo?: DocIntelligenceRepository;
    legalDrafter?: LegalDrafterRouteService;
    legalDraftRepo?: LegalDraftRepository;
    voiceAgent?: VoiceAgentSlice;
  } = {};

  // --- voice agent (always wires; durable Drizzle persistence) -------------
  const voiceWiring =
    deps.voiceAgentWiring ??
    createVoiceAgentWiring({
      db: deps.db,
      ...(deps.kernelThink ? { kernelThink: deps.kernelThink } : {}),
    });
  if (voiceWiring) {
    services.voiceAgent = voiceWiring.agent;
  }

  // --- LLM-backed capabilities (require an Anthropic client) ---------------
  const buildClient = deps.buildAnthropicClient;
  if (buildClient) {
    // dynamic-pricing — singleton service (LLM port reads inputs.tenantId).
    const priceRepo = createInMemoryPriceRecommendationRepo();
    const optimizer = DynamicPricingNs.createDynamicPriceOptimizer({
      llm: createPricingLlmPort(buildClient),
      repo: priceRepo,
      priceControl: createPriceControlLookup(),
      // No `ledger` here: the per-tenant budget-guarded client owns budget
      // assertion + usage recording (recorded exactly once). The route
      // adapter runs an independent pre-flight for the 402 contract.
    });
    services.dynamicPricing = createDynamicPricingRouteService(
      optimizer,
      deps.ledger,
    );

    // doc-intelligence — per-tenant service (LLM port is tenant-bound).
    const docRepo = createInMemoryDocIntelligenceRepo();
    services.docIntelligenceRepo = docRepo;
    services.docIntelligence = createDocIntelligenceRouteService(
      (tenantId: string) =>
        DocIntelligenceNs.createDocumentIntelligence({
          llm: createDocIntelligenceLlmPort(buildClient, tenantId),
          repo: docRepo,
        }),
      deps.ledger,
    );

    // legal-drafter — singleton service (LLM port reads context.tenantId).
    const legalRepo = createInMemoryLegalDraftRepo();
    services.legalDraftRepo = legalRepo;
    const drafter = LegalDrafterNs.createLegalDrafter({
      llm: createLegalDrafterLlmPort(buildClient),
      legalLaw: createLegalLawDispatchPort(),
      repo: legalRepo,
    });
    services.legalDrafter = createLegalDrafterRouteService(
      drafter,
      deps.ledger,
    );
  }

  return Object.freeze(services);
}
