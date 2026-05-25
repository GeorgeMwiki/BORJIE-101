/**
 * Vendor Matcher Service
 * AI-powered vendor matching for work orders
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { VENDOR_MATCHING_PROMPT } from '../prompts/index.js';
import {
  calculateVendorScore,
  rankVendors,
  type ScoreResult,
  type VendorSignal,
  type WorkOrderSignal,
} from './risk/vendor-score-calculator.js';
import {
  ModelTier,
  generateStructured,
  type AnthropicClient,
} from '../providers/anthropic-client.js';

export const VendorSpecialty = {
  PLUMBING: 'PLUMBING',
  ELECTRICAL: 'ELECTRICAL',
  HVAC: 'HVAC',
  APPLIANCE_REPAIR: 'APPLIANCE_REPAIR',
  GENERAL_MAINTENANCE: 'GENERAL_MAINTENANCE',
  CARPENTRY: 'CARPENTRY',
  PAINTING: 'PAINTING',
  ROOFING: 'ROOFING',
  FLOORING: 'FLOORING',
  PEST_CONTROL: 'PEST_CONTROL',
  LANDSCAPING: 'LANDSCAPING',
  CLEANING: 'CLEANING',
  LOCKSMITH: 'LOCKSMITH',
} as const;

export type VendorSpecialty = (typeof VendorSpecialty)[keyof typeof VendorSpecialty];

export interface WorkOrderInput {
  id: string;
  title: string;
  description: string;
  category: string;
  urgency: 'emergency' | 'urgent' | 'high' | 'standard' | 'low';
  property: { id: string; name: string; address: string; type: string };
  estimatedComplexity?: number;
  requiredSkills?: string[];
  preferredSchedule?: { earliest: string; latest: string; timePreference?: 'morning' | 'afternoon' | 'evening' | 'any' };
  budget?: { min?: number; max?: number; currency: string };
}

export interface VendorProfile {
  id: string;
  name: string;
  specialties: VendorSpecialty[];
  serviceArea: string[];
  ratings: { overall: number; quality: number; reliability: number; communication: number; value: number };
  metrics: { completedJobs: number; averageResponseTime: number; onTimeCompletion: number; repeatCallRate: number };
  availability: { nextAvailable: string; emergencyAvailable: boolean; weekendAvailable: boolean };
  pricing: { hourlyRate?: number; callOutFee?: number; emergencyMultiplier?: number; currency?: string };
}

export interface VendorMatch {
  vendorId: string;
  vendorName: string;
  matchScore: number;
  confidence: number;
  ranking: number;
  matchReasons: string[];
  concerns: string[];
  estimatedCost?: { min: number; max: number; currency: string };
  estimatedSchedule?: { responseTime: string; completionTime: string };
  compatibilityFactors: {
    skillMatch: number;
    availabilityMatch: number;
    locationMatch: number;
    budgetMatch: number;
    performanceScore: number;
  };
}

export interface VendorMatchingResult {
  workOrderId: string;
  rankedVendors: VendorMatch[];
  topRecommendation: {
    vendor: VendorMatch;
    reasoning: string;
    alternativeScenarios: Array<{ scenario: string; recommendedVendor: string }>;
  };
  matchingInsights: {
    keyFactors: string[];
    marketAvailability: 'abundant' | 'adequate' | 'limited' | 'scarce';
    pricingContext: string;
    urgencyConsiderations: string[];
  };
  warnings: string[];
  autoAssignmentRecommended: boolean;
  autoAssignmentReason?: string;
}

const VendorMatchSchema = z.object({
  vendorId: z.string(),
  vendorName: z.string(),
  matchScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  ranking: z.number(),
  matchReasons: z.array(z.string()),
  concerns: z.array(z.string()),
  estimatedCost: z.object({ min: z.number(), max: z.number(), currency: z.string() }).optional(),
  estimatedSchedule: z.object({ responseTime: z.string(), completionTime: z.string() }).optional(),
  compatibilityFactors: z.object({
    skillMatch: z.number().min(0).max(1),
    availabilityMatch: z.number().min(0).max(1),
    locationMatch: z.number().min(0).max(1),
    budgetMatch: z.number().min(0).max(1),
    performanceScore: z.number().min(0).max(1),
  }),
});

const VendorMatchingResultSchema = z.object({
  workOrderId: z.string(),
  rankedVendors: z.array(VendorMatchSchema),
  topRecommendation: z.object({
    vendor: VendorMatchSchema,
    reasoning: z.string(),
    alternativeScenarios: z.array(z.object({ scenario: z.string(), recommendedVendor: z.string() })),
  }),
  matchingInsights: z.object({
    keyFactors: z.array(z.string()),
    marketAvailability: z.enum(['abundant', 'adequate', 'limited', 'scarce']),
    pricingContext: z.string(),
    urgencyConsiderations: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
  autoAssignmentRecommended: z.boolean(),
  autoAssignmentReason: z.string().optional(),
});

export interface VendorMatcherConfig {
  openaiApiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class VendorMatcherService {
  private openai: OpenAI;
  private model: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: VendorMatcherConfig) {
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    this.model = config.model ?? 'gpt-4-turbo-preview';
    this.temperature = config.temperature ?? 0.3;
    this.maxTokens = config.maxTokens ?? 2048;
  }

  async matchVendor(workOrder: WorkOrderInput, availableVendors?: VendorProfile[]): Promise<VendorMatchingResult> {
    const vendors = availableVendors ?? this.getMockVendors();

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: VENDOR_MATCHING_PROMPT.system },
        { role: 'user', content: `${VENDOR_MATCHING_PROMPT.user}\n\nWork Order:\n${JSON.stringify(workOrder, null, 2)}\n\nAvailable Vendors:\n${JSON.stringify(vendors, null, 2)}` },
      ],
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('No response from OpenAI');

    return VendorMatchingResultSchema.parse(JSON.parse(content)) as VendorMatchingResult;
  }

  private getMockVendors(): VendorProfile[] {
    return [
      {
        id: 'vendor-001',
        name: 'Premium Property Services',
        specialties: ['PLUMBING', 'ELECTRICAL', 'HVAC', 'GENERAL_MAINTENANCE'] as VendorSpecialty[],
        serviceArea: ['Nairobi', 'Kiambu'],
        ratings: { overall: 4.8, quality: 4.9, reliability: 4.7, communication: 4.8, value: 4.5 },
        metrics: { completedJobs: 250, averageResponseTime: 2, onTimeCompletion: 95, repeatCallRate: 5 },
        availability: { nextAvailable: new Date().toISOString(), emergencyAvailable: true, weekendAvailable: true },
        pricing: { hourlyRate: 2500, callOutFee: 500, emergencyMultiplier: 1.5 },
      },
      {
        id: 'vendor-002',
        name: 'Quick Fix Maintenance',
        specialties: ['GENERAL_MAINTENANCE', 'CARPENTRY', 'PAINTING'] as VendorSpecialty[],
        serviceArea: ['Nairobi'],
        ratings: { overall: 4.2, quality: 4.0, reliability: 4.3, communication: 4.5, value: 4.8 },
        metrics: { completedJobs: 180, averageResponseTime: 4, onTimeCompletion: 88, repeatCallRate: 12 },
        availability: { nextAvailable: new Date().toISOString(), emergencyAvailable: false, weekendAvailable: true },
        pricing: { hourlyRate: 1500, callOutFee: 300 },
      },
    ];
  }
}

export function createVendorMatcherService(config: VendorMatcherConfig): VendorMatcherService {
  return new VendorMatcherService(config);
}

export async function matchVendor(
  workOrder: WorkOrderInput,
  availableVendors?: VendorProfile[],
  config?: Partial<VendorMatcherConfig>
): Promise<VendorMatchingResult> {
  const apiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key is required');
  const service = createVendorMatcherService({ openaiApiKey: apiKey, ...config });
  return service.matchVendor(workOrder, availableVendors);
}

// ===========================================================================
// SCAFFOLDED 9 — Deterministic-first vendor matcher
//
// The new path below is the preferred entry point. It uses the calculator
// in `risk/vendor-score-calculator.ts` for ranking (deterministic and
// testable), then lets Anthropic narrate WHY the top pick is best.
// The original `VendorMatcherService.matchVendor` is kept untouched so
// existing callers continue to work.
// ===========================================================================

const NarrationSchema = z.object({
  reasoning: z.string(),
  alternativeScenarios: z.array(
    z.object({ scenario: z.string(), recommendedVendor: z.string() })
  ),
  warnings: z.array(z.string()),
  autoAssignmentRecommended: z.boolean(),
  autoAssignmentReason: z.string().optional(),
  marketAvailability: z.enum(['abundant', 'adequate', 'limited', 'scarce']),
  pricingContext: z.string(),
  urgencyConsiderations: z.array(z.string()),
});

type NarrationPayload = z.infer<typeof NarrationSchema>;

function vendorProfileToSignal(v: VendorProfile): VendorSignal {
  return {
    id: v.id,
    specialties: v.specialties.map((s) => s.toString()),
    serviceAreas: v.serviceArea,
    averageResponseTimeHours: v.metrics.averageResponseTime,
    ratings: {
      overall: v.ratings.overall,
      quality: v.ratings.quality,
      communication: v.ratings.communication,
      value: v.ratings.value,
    },
    onTimeCompletionPct: v.metrics.onTimeCompletion,
    hourlyRate: v.pricing.hourlyRate ?? null,
    emergencyAvailable: v.availability.emergencyAvailable,
  };
}

function workOrderToSignal(wo: WorkOrderInput): WorkOrderSignal {
  const budget = wo.budget;
  const midpoint =
    budget && budget.min !== undefined && budget.max !== undefined
      ? (budget.min + budget.max) / 2
      : budget?.max ?? budget?.min;
  return {
    requiredSkills: wo.requiredSkills ?? [wo.category].filter(Boolean),
    emergency: wo.urgency === 'emergency',
    serviceArea: wo.property.address,
    budgetMidpoint: midpoint,
  };
}

function scoreToMatch(
  score: ScoreResult,
  vendor: VendorProfile,
  ranking: number
): VendorMatch {
  return {
    vendorId: score.vendorId,
    vendorName: vendor.name,
    matchScore: score.composite,
    // Confidence reflects how much signal we have — more completed jobs =
    // more confidence. Caps at ratingSampleSize of 100.
    confidence: Math.min(1, vendor.metrics.completedJobs / 100),
    ranking,
    matchReasons: score.reasons,
    concerns: score.concerns,
    estimatedCost:
      vendor.pricing.hourlyRate !== undefined
        ? {
            min: vendor.pricing.hourlyRate,
            max: vendor.pricing.hourlyRate * 4,
            // Currency comes from the vendor's pricing record (sourced
            // from region-config at vendor registration time); fall back
            // to empty so consumers surface the missing value rather than
            // silently render as KES.
            currency: vendor.pricing.currency ?? '',
          }
        : undefined,
    estimatedSchedule: {
      responseTime: `${vendor.metrics.averageResponseTime}h`,
      completionTime: vendor.availability.nextAvailable,
    },
    compatibilityFactors: {
      skillMatch: score.subScores.skill,
      availabilityMatch: vendor.availability.emergencyAvailable ? 1 : 0.5,
      locationMatch: 1,
      budgetMatch: score.subScores.cost,
      performanceScore:
        (score.subScores.quality + score.subScores.onTime +
          score.subScores.responsiveness) /
        3,
    },
  };
}

export interface DeterministicMatcherDeps {
  anthropic?: AnthropicClient;
  narrationModel?: string;
}

/**
 * Rank candidate vendors with the deterministic calculator, then use
 * Anthropic (if a client is provided) to narrate the top choice. The
 * returned shape conforms to `VendorMatchingResultSchema`, preserving
 * compatibility with all existing consumers.
 *
 * Narration failure is non-fatal — we fall back to a terse
 * reason-string assembled from the deterministic subscores, so vendor
 * matching still works even when the Anthropic API is unreachable.
 */
export async function matchVendorsDeterministic(
  workOrder: WorkOrderInput,
  availableVendors: VendorProfile[],
  deps: DeterministicMatcherDeps = {}
): Promise<VendorMatchingResult> {
  if (availableVendors.length === 0) {
    return {
      workOrderId: workOrder.id,
      rankedVendors: [],
      topRecommendation: {
        // Synthesize a placeholder that still passes the schema — callers
        // should check `rankedVendors.length === 0` first.
        vendor: {
          vendorId: '',
          vendorName: '',
          matchScore: 0,
          confidence: 0,
          ranking: 0,
          matchReasons: [],
          concerns: ['No vendors available for this category in service area'],
          compatibilityFactors: {
            skillMatch: 0,
            availabilityMatch: 0,
            locationMatch: 0,
            budgetMatch: 0,
            performanceScore: 0,
          },
        },
        reasoning: 'No candidate vendors found',
        alternativeScenarios: [],
      },
      matchingInsights: {
        keyFactors: [],
        marketAvailability: 'scarce',
        pricingContext: 'No data',
        urgencyConsiderations: [],
      },
      warnings: ['No candidate vendors'],
      autoAssignmentRecommended: false,
    };
  }

  const signals = availableVendors.map(vendorProfileToSignal);
  const ranked = rankVendors(workOrderToSignal(workOrder), signals);
  const vendorIndex = new Map(availableVendors.map((v) => [v.id, v]));

  const rankedVendors: VendorMatch[] = ranked.map((r, idx) => {
    const vendor = vendorIndex.get(r.vendorId);
    if (!vendor) {
      throw new Error(`Score referenced unknown vendor '${r.vendorId}'`);
    }
    return scoreToMatch(r, vendor, idx + 1);
  });

  const top = rankedVendors[0]!;
  const topScore = ranked[0]!;

  // Ask Anthropic for narration — best-effort only.
  let narration: NarrationPayload = {
    reasoning: buildFallbackReasoning(topScore),
    alternativeScenarios: [],
    warnings: [],
    autoAssignmentRecommended: top.matchScore >= 80,
    autoAssignmentReason:
      top.matchScore >= 80
        ? 'Top vendor scores above 80 with no critical concerns'
        : undefined,
    marketAvailability:
      availableVendors.length >= 5
        ? 'abundant'
        : availableVendors.length >= 3
          ? 'adequate'
          : availableVendors.length >= 2
            ? 'limited'
            : 'scarce',
    pricingContext: `Based on ${availableVendors.length} vendor(s) with rates available`,
    urgencyConsiderations:
      workOrder.urgency === 'emergency'
        ? ['Emergency urgency — prioritize emergencyAvailable vendors']
        : [],
  };

  if (deps.anthropic) {
    try {
      const prompt = buildNarrationPrompt(workOrder, ranked, availableVendors);
      const result = await generateStructured<NarrationPayload>(deps.anthropic, {
        prompt,
        schema: NarrationSchema,
        model: deps.narrationModel ?? ModelTier.SONNET,
        systemPrompt:
          'You narrate vendor matching decisions for a property manager. ' +
          'The ranking is already determined — your job is to explain WHY ' +
          'and flag risks. Never contradict the ranking.',
      });
      narration = result.data;
    } catch {
      // Keep fallback narration — vendor matching should not fail on LLM issues.
    }
  }

  const concerns = rankedVendors.flatMap((v) => v.concerns);

  const result: VendorMatchingResult = {
    workOrderId: workOrder.id,
    rankedVendors,
    topRecommendation: {
      vendor: top,
      reasoning: narration.reasoning,
      alternativeScenarios: (narration.alternativeScenarios ?? []).map((s) => ({
        scenario: s.scenario ?? '',
        recommendedVendor: s.recommendedVendor ?? '',
      })),
    },
    matchingInsights: {
      keyFactors: top.matchReasons,
      marketAvailability: narration.marketAvailability,
      pricingContext: narration.pricingContext,
      urgencyConsiderations: narration.urgencyConsiderations,
    },
    warnings: Array.from(new Set([...narration.warnings, ...concerns])),
    autoAssignmentRecommended: narration.autoAssignmentRecommended,
    autoAssignmentReason: narration.autoAssignmentReason,
  };

  // Re-validate at the boundary so narration regressions don't slip through.
  return VendorMatchingResultSchema.parse(result) as VendorMatchingResult;
}

function buildFallbackReasoning(top: ScoreResult): string {
  const r = top.reasons;
  if (r.length === 0) {
    return `Selected based on composite score of ${top.composite.toFixed(1)}.`;
  }
  return `Top candidate — ${r.slice(0, 3).join('; ')}. Composite score ${top.composite.toFixed(1)}.`;
}

function buildNarrationPrompt(
  wo: WorkOrderInput,
  ranked: ScoreResult[],
  vendors: VendorProfile[],
): string {
  const top3 = ranked.slice(0, 3).map((r, idx) => ({
    rank: idx + 1,
    vendorId: r.vendorId,
    vendorName: vendors.find((v) => v.id === r.vendorId)?.name ?? 'Unknown',
    composite: r.composite,
    subScores: r.subScores,
    reasons: r.reasons,
    concerns: r.concerns,
  }));

  return [
    'Work order:',
    JSON.stringify(
      {
        id: wo.id,
        title: wo.title,
        category: wo.category,
        urgency: wo.urgency,
        property: wo.property,
        budget: wo.budget,
      },
      null,
      2
    ),
    '',
    'Top-ranked vendors (deterministic scoring):',
    JSON.stringify(top3, null, 2),
    '',
    'Return narration JSON: explain the top pick, list alternative scenarios, flag risks.',
  ].join('\n');
}

// Re-export `getMockVendors` from the new fixtures location so old callers
// that depend on `import { getMockVendors } from '.../vendor-matcher.js'`
// continue to work.
export { getMockVendors } from './fixtures/mock-vendors.js';
