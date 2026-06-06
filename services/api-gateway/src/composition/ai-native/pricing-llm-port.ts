/**
 * Real `PricingLLMPort` for the dynamic-pricing optimizer.
 *
 * Issues a budget-guarded Anthropic completion that reasons over the
 * pre-assembled mineral-pricing signals (market drift, production rollup,
 * churn risk, pit condition, seasonality) and returns a recommended price
 * in minor units plus a confidence and an evidence-grounded justification.
 *
 * The optimizer clamps the result against the jurisdiction's royalty cap,
 * persists it, and queues it for human approval — this port never applies a
 * price. Output is strict JSON; a parse failure raises so the optimizer
 * maps it to `UPSTREAM_ERROR`.
 */

import { DynamicPricing as DynamicPricingNs } from '@borjie/ai-copilot/ai-native';
import {
  callGuardedAnthropic,
  parseLlmJson,
  type GuardedAnthropicFactory,
} from './llm-client.js';

type PricingLLMPort = DynamicPricingNs.PricingLLMPort;
type PricingInputs = DynamicPricingNs.PricingInputs;

interface PricingLlmJson {
  readonly recommendedPriceMinor: number;
  readonly confidence: number;
  readonly explanation: string;
}

const SYSTEM_PROMPT = [
  'You are a mineral-commodity pricing analyst for a Tanzanian (pan-African)',
  'artisanal-to-mid-tier mining estate operating system. You set per-pit',
  'mineral sale/offtake prices, NOT property rents.',
  '',
  'You receive pre-assembled signals for one pit. Recommend a new price in',
  'integer MINOR currency units (e.g. cents). Justify the delta strictly',
  'from the supplied evidence — market drift, production capacity, churn',
  'risk, pit condition grade, seasonality. Never invent figures.',
  '',
  'A regulator royalty-escalation cap may clamp your output downstream, so',
  'recommend the economically optimal price and let the caller clamp.',
  '',
  'Respond with ONLY a JSON object, no prose, no code fence:',
  '{"recommendedPriceMinor": <integer>, "confidence": <0..1>,',
  ' "explanation": "<one paragraph citing the signals you used>"}',
].join('\n');

function buildUserPrompt(inputs: PricingInputs): string {
  const lines: string[] = [
    `currencyCode: ${inputs.currencyCode}`,
    `countryCode: ${inputs.countryCode}`,
    `currentPriceMinor: ${inputs.currentPriceMinor}`,
  ];
  if (inputs.market) {
    lines.push(
      `market: drift=${inputs.market.driftFlag ?? 'unknown'} ` +
        `median=${inputs.market.marketMedianMinor ?? 'n/a'} ` +
        `p25=${inputs.market.marketP25Minor ?? 'n/a'} ` +
        `p75=${inputs.market.marketP75Minor ?? 'n/a'} ` +
        `sampleSize=${inputs.market.sampleSize}`,
    );
  }
  if (inputs.production) {
    lines.push(
      `production: pct=${inputs.production.productionPct.toFixed(3)} ` +
        `availableCapacityDays=${inputs.production.availableCapacityDays} ` +
        `windowDays=${inputs.production.windowDays}`,
    );
  }
  if (inputs.churn) {
    lines.push(
      `churn: probability=${inputs.churn.churnProbability.toFixed(3)} ` +
        `horizonDays=${inputs.churn.horizonDays}`,
    );
  }
  if (inputs.inspection) {
    lines.push(
      `pitCondition: grade=${inputs.inspection.conditionGrade} ` +
        `issues=${inputs.inspection.issuesCount}`,
    );
  }
  if (inputs.seasonalityMonth) {
    lines.push(`seasonalityMonth: ${inputs.seasonalityMonth}`);
  }
  return lines.join('\n');
}

const MAX_TOKENS = 1024;

/**
 * Build the Anthropic-backed pricing LLM port. The optimizer supplies the
 * promptHash (used for the prompt-hash audit trail); this port owns only
 * the model round-trip + JSON shaping.
 */
export function createPricingLlmPort(
  buildClient: GuardedAnthropicFactory,
): PricingLLMPort {
  return {
    async propose({ inputs }) {
      const result = await callGuardedAnthropic(buildClient, {
        tenantId: inputs.tenantId,
        operation: 'ai-native.dynamic-pricing.propose',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(inputs),
        maxTokens: MAX_TOKENS,
        temperature: 0,
      });

      const parsed = parseLlmJson<PricingLlmJson>(result.text);
      if (
        !parsed ||
        typeof parsed.recommendedPriceMinor !== 'number' ||
        !Number.isFinite(parsed.recommendedPriceMinor)
      ) {
        throw new Error('pricing LLM returned unparseable or invalid JSON');
      }

      return {
        recommendedPriceMinor: Math.max(0, Math.round(parsed.recommendedPriceMinor)),
        confidence:
          typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
            ? parsed.confidence
            : 0,
        explanation:
          typeof parsed.explanation === 'string' && parsed.explanation.trim() !== ''
            ? parsed.explanation
            : 'No explanation returned by the pricing model.',
        modelVersion: result.modelVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        // Cost recorded by the budget-guarded client; the optimizer's own
        // ledger recording is disabled (no double-charge).
        costUsdMicro: 0,
      };
    },
  };
}
