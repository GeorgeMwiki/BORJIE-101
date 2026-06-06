/**
 * Route-facing adapters for the AI-native PhL services.
 *
 * The `/ai-native` router (`routes/ai-native.router.ts`) was ported from the
 * BossNyumba property product and still speaks property vocabulary on the
 * wire (`unitId`, `currentRentMinor`, `propertyId`, `occupancy`,
 * `subjectLeaseId`, ...). The backing PhL factories in
 * `@borjie/ai-copilot/ai-native` speak mining vocabulary (`pitId`,
 * `currentPriceMinor`, `siteId`, `production`, `subjectOfftakeId`, ...).
 *
 * These thin adapters translate the route's request shape onto the PhL
 * factory input, preserving the exact method names + result envelopes the
 * route reads (`{ success, data } | { success: false, code, message }`).
 *
 * Budget: a pre-flight `ledger.assertWithinBudget(tenantId)` here maps a
 * tenant over-cap to the typed `BUDGET_EXCEEDED` (402) the route expects,
 * BEFORE the model round-trip. Actual enforcement + usage recording happen
 * inside the per-tenant budget-guarded Anthropic client (recorded once).
 */

import { AiBudgetExceededError } from '@borjie/ai-copilot';
import type {
  DynamicPricing as DynamicPricingNs,
  DocIntelligence as DocIntelligenceNs,
  LegalDrafter as LegalDrafterNs,
} from '@borjie/ai-copilot/ai-native';

type DynamicPriceOptimizer = DynamicPricingNs.DynamicPriceOptimizer;
type PricingInputs = DynamicPricingNs.PricingInputs;
type DocumentIntelligence = DocIntelligenceNs.DocumentIntelligence;
type LegalDrafter = LegalDrafterNs.LegalDrafter;
type LegalDocumentKind = LegalDrafterNs.LegalDocumentKind;

/** Minimal slice of `CostLedger` the pre-flight budget check needs. */
export interface BudgetAsserter {
  assertWithinBudget(tenantId: string): Promise<void>;
}

/**
 * Run the pre-flight budget assert. Returns a typed `BUDGET_EXCEEDED`
 * envelope when over-cap, or `null` to proceed. A null ledger is a no-op
 * (the guarded client still enforces at call time).
 */
async function assertBudgetOrEnvelope(
  ledger: BudgetAsserter | null,
  tenantId: string,
): Promise<{ success: false; code: 'BUDGET_EXCEEDED'; message: string } | null> {
  if (!ledger) return null;
  try {
    await ledger.assertWithinBudget(tenantId);
    return null;
  } catch (err) {
    if (err instanceof AiBudgetExceededError) {
      return { success: false, code: 'BUDGET_EXCEEDED', message: err.message };
    }
    throw err;
  }
}

// ===========================================================================
// dynamic-pricing
// ===========================================================================

/** Route request for `dynamicPricing.propose` (property vocabulary on wire). */
export interface DynamicPricingRouteInput {
  readonly tenantId: string;
  readonly unitId: string;
  readonly propertyId?: string;
  readonly countryCode: string;
  readonly currentRentMinor: number;
  readonly currencyCode: string;
  readonly seasonalityMonth?: number;
  readonly market?: {
    readonly id: string;
    readonly unitId: string;
    readonly currencyCode: string;
    readonly ourRentMinor: number;
    readonly marketMedianMinor: number | null;
    readonly marketP25Minor: number | null;
    readonly marketP75Minor: number | null;
    readonly sampleSize: number;
    readonly driftFlag: 'below_market' | 'above_market' | 'on_band' | null;
    readonly observedAt: string;
  };
  readonly occupancy?: {
    readonly unitId: string;
    readonly windowDays: number;
    readonly occupancyPct: number;
    readonly vacancyDays: number;
    readonly rollupHash: string;
  };
  readonly churn?: {
    readonly id: string;
    readonly customerId: string;
    readonly unitId: string;
    readonly churnProbability: number;
    readonly horizonDays: number;
  };
  readonly inspection?: {
    readonly id: string;
    readonly unitId: string;
    readonly conditionGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    readonly issuesCount: number;
    readonly observedAt: string;
  };
}

/** Translate the property-shaped route input onto mining `PricingInputs`. */
function toPricingInputs(input: DynamicPricingRouteInput): PricingInputs {
  return {
    tenantId: input.tenantId,
    pitId: input.unitId,
    ...(input.propertyId !== undefined ? { siteId: input.propertyId } : {}),
    countryCode: input.countryCode,
    currentPriceMinor: input.currentRentMinor,
    currencyCode: input.currencyCode,
    ...(input.seasonalityMonth !== undefined
      ? { seasonalityMonth: input.seasonalityMonth }
      : {}),
    ...(input.market
      ? {
          market: {
            id: input.market.id,
            pitId: input.market.unitId,
            currencyCode: input.market.currencyCode,
            ourPriceMinor: input.market.ourRentMinor,
            marketMedianMinor: input.market.marketMedianMinor,
            marketP25Minor: input.market.marketP25Minor,
            marketP75Minor: input.market.marketP75Minor,
            sampleSize: input.market.sampleSize,
            driftFlag: input.market.driftFlag,
            observedAt: input.market.observedAt,
          },
        }
      : {}),
    ...(input.occupancy
      ? {
          production: {
            pitId: input.occupancy.unitId,
            windowDays: input.occupancy.windowDays,
            productionPct: input.occupancy.occupancyPct,
            availableCapacityDays: input.occupancy.vacancyDays,
            rollupHash: input.occupancy.rollupHash,
          },
        }
      : {}),
    ...(input.churn
      ? {
          churn: {
            id: input.churn.id,
            customerId: input.churn.customerId,
            pitId: input.churn.unitId,
            churnProbability: input.churn.churnProbability,
            horizonDays: input.churn.horizonDays,
          },
        }
      : {}),
    ...(input.inspection
      ? {
          inspection: {
            id: input.inspection.id,
            pitId: input.inspection.unitId,
            conditionGrade: input.inspection.conditionGrade,
            issuesCount: input.inspection.issuesCount,
            observedAt: input.inspection.observedAt,
          },
        }
      : {}),
  };
}

export interface DynamicPricingRouteService {
  propose(
    input: DynamicPricingRouteInput,
    options?: { readonly correlationId?: string; readonly autoQueue?: boolean },
  ): ReturnType<DynamicPriceOptimizer['propose']>;
}

/**
 * Wrap the mining `DynamicPriceOptimizer` behind the property-shaped route
 * contract. Pre-flights the budget check, then delegates with translated
 * inputs.
 */
export function createDynamicPricingRouteService(
  optimizer: DynamicPriceOptimizer,
  ledger: BudgetAsserter | null,
): DynamicPricingRouteService {
  return {
    async propose(input, options) {
      const overBudget = await assertBudgetOrEnvelope(ledger, input.tenantId);
      if (overBudget) return overBudget;
      return optimizer.propose(toPricingInputs(input), options);
    },
  };
}

// ===========================================================================
// doc-intelligence — direct passthrough (vocabulary already aligned)
// ===========================================================================

export interface DocIntelligenceRouteInput {
  readonly tenantId: string;
  readonly documentId: string;
  readonly canonicalText: string;
  readonly languageHint?: string;
  readonly countryCode?: string;
}

export interface DocIntelligenceRouteService {
  extract(
    input: DocIntelligenceRouteInput,
    options?: { readonly correlationId?: string },
  ): ReturnType<DocumentIntelligence['extract']>;
}

/**
 * Wrap the doc-intelligence service. `buildService` constructs a fresh,
 * tenant-bound `DocumentIntelligence` per call (the LLM port is bound to the
 * calling tenant for budget-guarded calls — concurrency-safe). Pre-flights
 * the budget check.
 */
export function createDocIntelligenceRouteService(
  buildService: (tenantId: string) => DocumentIntelligence,
  ledger: BudgetAsserter | null,
): DocIntelligenceRouteService {
  return {
    async extract(input, options) {
      const overBudget = await assertBudgetOrEnvelope(ledger, input.tenantId);
      if (overBudget) return overBudget;
      const service = buildService(input.tenantId);
      const extractionInput = {
        tenantId: input.tenantId,
        documentId: input.documentId,
        canonicalText: input.canonicalText,
        ...(input.languageHint !== undefined
          ? { languageHint: input.languageHint }
          : {}),
        ...(input.countryCode !== undefined
          ? { countryCode: input.countryCode }
          : {}),
      };
      return service.extract(extractionInput, options);
    },
  };
}

// ===========================================================================
// legal-drafter — map property subjects onto mining subjects
// ===========================================================================

export interface LegalDraftRouteInput {
  readonly documentKind: LegalDocumentKind;
  readonly context: {
    readonly tenantId: string;
    readonly countryCode: string;
    readonly subdivision?: string;
    readonly languageCode?: string;
    readonly subjectCustomerId?: string;
    readonly subjectLeaseId?: string;
    readonly subjectPropertyId?: string;
    readonly subjectUnitId?: string;
  };
  readonly facts: Readonly<Record<string, unknown>>;
  readonly correlationId?: string;
}

export interface LegalDrafterRouteService {
  draft(input: LegalDraftRouteInput): ReturnType<LegalDrafter['draft']>;
}

/**
 * Wrap the mining `LegalDrafter` behind the property-shaped route contract.
 * Maps the wire's lease/property/unit subjects onto offtake/site/pit.
 */
export function createLegalDrafterRouteService(
  drafter: LegalDrafter,
  ledger: BudgetAsserter | null,
): LegalDrafterRouteService {
  return {
    async draft(input) {
      const overBudget = await assertBudgetOrEnvelope(
        ledger,
        input.context.tenantId,
      );
      if (overBudget) return overBudget;
      return drafter.draft({
        documentKind: input.documentKind,
        context: {
          tenantId: input.context.tenantId,
          countryCode: input.context.countryCode,
          ...(input.context.subdivision !== undefined
            ? { subdivision: input.context.subdivision }
            : {}),
          ...(input.context.languageCode !== undefined
            ? { languageCode: input.context.languageCode }
            : {}),
          ...(input.context.subjectCustomerId !== undefined
            ? { subjectCustomerId: input.context.subjectCustomerId }
            : {}),
          ...(input.context.subjectLeaseId !== undefined
            ? { subjectOfftakeId: input.context.subjectLeaseId }
            : {}),
          ...(input.context.subjectPropertyId !== undefined
            ? { subjectSiteId: input.context.subjectPropertyId }
            : {}),
          ...(input.context.subjectUnitId !== undefined
            ? { subjectPitId: input.context.subjectUnitId }
            : {}),
        },
        facts: input.facts,
        ...(input.correlationId !== undefined
          ? { correlationId: input.correlationId }
          : {}),
      });
    },
  };
}
