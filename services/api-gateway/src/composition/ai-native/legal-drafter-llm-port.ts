/**
 * Real `LegalDrafterLLMPort` for the legal draftsperson.
 *
 * Issues a budget-guarded Anthropic completion that composes a FIRST DRAFT
 * of a mining-estate legal document (offtake addendum, royalty-increase
 * notice, cure-or-cease, licence-suspension notice, etc.) in the tenant's
 * language, citing the jurisdiction's mandatory clauses resolved by the
 * compliance plugin.
 *
 * Every draft is queued for human review by the drafter (licence-suspension
 * notices can NEVER auto-send). This port owns only the model round-trip +
 * JSON shaping; the drafter owns autonomy, persistence, and citations.
 *
 * The `compose` input carries `context.tenantId`, so the port reads the
 * tenant directly — no per-request construction needed.
 */

import { LegalDrafter as LegalDrafterNs } from '@borjie/ai-copilot/ai-native';
import {
  callGuardedAnthropic,
  parseLlmJson,
  type GuardedAnthropicFactory,
} from './llm-client.js';

type LegalDrafterLLMPort = LegalDrafterNs.LegalDrafterLLMPort;
type LegalLawSnapshot = LegalDrafterNs.LegalLawSnapshot;
type LegalDocumentKind = LegalDrafterNs.LegalDocumentKind;
type DraftFacts = LegalDrafterNs.DraftFacts;
type TenantContextForLegal = LegalDrafterNs.TenantContextForLegal;

interface LegalLlmJson {
  readonly title?: string;
  readonly body?: string;
  readonly languageCode?: string;
  readonly reviewFlags?: readonly string[];
  readonly citedClauses?: readonly string[];
  readonly confidence?: number;
}

const SYSTEM_PROMPT = [
  'You are a mining-estate legal draftsperson for a Tanzanian (pan-African)',
  'mining operating system. You compose FIRST DRAFTS only — every output is',
  'reviewed by a human before it can be sent. Documents concern mineral-',
  'rights licences, offtake/supply agreements, and royalty obligations.',
  '',
  'You are given: the document kind, the tenant/jurisdiction context, the',
  'facts to incorporate, and the jurisdiction\'s mandatory required clauses',
  'with their statutory citations. Compose the draft in the requested',
  'language code (echo it back). You MUST cite/include the supplied required',
  'clauses — list the ones you used in citedClauses. Flag anything needing',
  'human attention in reviewFlags (e.g. missing_fact, ambiguous_amount,',
  'date_unspecified). Ground every assertion in the supplied facts; never',
  'invent figures, dates, or parties.',
  '',
  'Respond with ONLY a JSON object, no prose, no code fence:',
  '{"title":"...","body":"<full document body>","languageCode":"<iso>",',
  '"reviewFlags":[],"citedClauses":[],"confidence":<0..1>}',
].join('\n');

function buildUserPrompt(input: {
  readonly documentKind: LegalDocumentKind;
  readonly context: TenantContextForLegal;
  readonly facts: DraftFacts;
  readonly law: LegalLawSnapshot;
}): string {
  return [
    `documentKind: ${input.documentKind}`,
    `countryCode: ${input.context.countryCode}`,
    input.context.subdivision
      ? `subdivision: ${input.context.subdivision}`
      : null,
    `languageCode: ${input.context.languageCode ?? 'detect-and-echo'}`,
    `statutoryNoticeWindowDays: ${input.law.noticeWindowDays}`,
    `sourceTag: ${input.law.sourceTag}`,
    `requiredClauses: ${input.law.requiredClauses.join(' | ')}`,
    `statutoryCitations: ${input.law.citations.join(' | ')}`,
    `facts: ${JSON.stringify(input.facts)}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

const MAX_TOKENS = 4096;

/**
 * Build the Anthropic-backed legal-drafter LLM port.
 */
export function createLegalDrafterLlmPort(
  buildClient: GuardedAnthropicFactory,
): LegalDrafterLLMPort {
  return {
    async compose(input) {
      const result = await callGuardedAnthropic(buildClient, {
        tenantId: input.context.tenantId,
        operation: `ai-native.legal-drafter.${input.documentKind}`,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(input),
        maxTokens: MAX_TOKENS,
        temperature: 0,
      });

      const parsed = parseLlmJson<LegalLlmJson>(result.text);
      if (
        !parsed ||
        typeof parsed.body !== 'string' ||
        parsed.body.trim() === ''
      ) {
        throw new Error('legal-drafter LLM returned no usable draft body');
      }

      return {
        title:
          typeof parsed.title === 'string' && parsed.title.trim() !== ''
            ? parsed.title
            : `${input.documentKind} draft`,
        body: parsed.body,
        languageCode:
          typeof parsed.languageCode === 'string' &&
          parsed.languageCode.trim() !== ''
            ? parsed.languageCode
            : (input.context.languageCode ?? 'en'),
        reviewFlags: Array.isArray(parsed.reviewFlags)
          ? parsed.reviewFlags.filter((f): f is string => typeof f === 'string')
          : [],
        citedClauses: Array.isArray(parsed.citedClauses)
          ? parsed.citedClauses.filter(
              (c): c is string => typeof c === 'string',
            )
          : [...input.law.requiredClauses],
        modelVersion: result.modelVersion,
        confidence:
          typeof parsed.confidence === 'number' &&
          Number.isFinite(parsed.confidence)
            ? parsed.confidence
            : 0,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsdMicro: 0,
      };
    },
  };
}
