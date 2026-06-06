/**
 * Real `DocIntelligenceLLMPort` for document entity + obligation extraction.
 *
 * Issues a budget-guarded Anthropic completion over the canonical text of a
 * mining document (permit, mineral-rights licence, offtake/supply agreement,
 * NEMC filing) and returns:
 *   - the detected ISO-639 language (never defaulted to 'en'),
 *   - extracted entities (parties, sites, pits, dates, amounts, statutes)
 *     with character spans into the canonical text,
 *   - extracted obligations (who must do what, by when, consequence) with
 *     risk flags + spans.
 *
 * Every entity/obligation cites a character span so the UI can highlight the
 * source line. Output is strict JSON; a parse failure raises so the
 * extractor maps it to `UPSTREAM_ERROR`.
 */

import { DocIntelligence as DocIntelligenceNs } from '@borjie/ai-copilot/ai-native';
import {
  callGuardedAnthropic,
  parseLlmJson,
  type GuardedAnthropicFactory,
} from './llm-client.js';

type DocIntelligenceLLMPort = DocIntelligenceNs.DocIntelligenceLLMPort;
type DocIntelligenceLLMOutput = DocIntelligenceNs.DocIntelligenceLLMOutput;
type EntityKind = DocIntelligenceNs.EntityKind;

const ENTITY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'party',
  'property',
  'unit',
  'date',
  'amount',
  'currency',
  'jurisdiction',
  'contract_kind',
  'reference',
  'other',
]);

interface RawEntity {
  readonly entityKind?: string;
  readonly entityValue?: string;
  readonly entityRaw?: string;
  readonly normalizedForm?: Record<string, unknown>;
  readonly languageCode?: string | null;
  readonly spanStart?: number | null;
  readonly spanEnd?: number | null;
  readonly confidence?: number | null;
}

interface RawObligation {
  readonly obligor?: string;
  readonly obligee?: string | null;
  readonly actionSummary?: string;
  readonly dueDate?: string | null;
  readonly recurrence?: string | null;
  readonly consequenceIfMissed?: string | null;
  readonly riskFlags?: readonly string[];
  readonly languageCode?: string | null;
  readonly spanStart?: number | null;
  readonly spanEnd?: number | null;
  readonly confidence?: number | null;
  readonly explanation?: string | null;
}

interface DocLlmJson {
  readonly detectedLanguage?: string;
  readonly entities?: readonly RawEntity[];
  readonly obligations?: readonly RawObligation[];
}

const SYSTEM_PROMPT = [
  'You are a document-intelligence analyst for a Tanzanian (pan-African)',
  'mining estate operating system. You read mining documents: mineral-rights',
  'permits and licences (PML/ML/SML), offtake and supply agreements, royalty',
  'returns, and regulator (NEMC/Mining Commission) filings.',
  '',
  'From the supplied canonical document text you must:',
  '1. Detect the document language as an ISO-639-1/-2 code. Never assume',
  '   English — detect it.',
  '2. Extract entities. entityKind MUST be one of: party, property, unit,',
  '   date, amount, currency, jurisdiction, contract_kind, reference, other.',
  '   (Map mining concepts: a mining site -> property, a pit -> unit.)',
  '3. Extract obligations: who (obligor) must do what (actionSummary), for',
  '   whom (obligee), by when (dueDate YYYY-MM-DD or null), recurrence, the',
  '   consequence if missed, and riskFlags (e.g. auto_renew, unlimited_',
  '   liability, ambiguous_clause, missing_standard_clause).',
  '',
  'For EVERY entity and obligation give spanStart and spanEnd as 0-based',
  'character offsets into the document text so the source line can be',
  'highlighted. confidence is 0..1.',
  '',
  'Respond with ONLY a JSON object, no prose, no code fence:',
  '{"detectedLanguage":"<iso>","entities":[{"entityKind":"...",',
  '"entityValue":"...","normalizedForm":{},"languageCode":"<iso>",',
  '"spanStart":<int>,"spanEnd":<int>,"confidence":<0..1>}],',
  '"obligations":[{"obligor":"...","obligee":"...","actionSummary":"...",',
  '"dueDate":null,"recurrence":null,"consequenceIfMissed":null,',
  '"riskFlags":[],"languageCode":"<iso>","spanStart":<int>,"spanEnd":<int>,',
  '"confidence":<0..1>,"explanation":null}]}',
].join('\n');

const MAX_TOKENS = 4096;
/** Guard against pathological prompt sizes — head of the document is enough
 *  to detect language + the salient clauses without unbounded token cost. */
const MAX_TEXT_CHARS = 40_000;

function coerceEntityKind(raw: string | undefined): EntityKind {
  if (raw && ENTITY_KINDS.has(raw as EntityKind)) return raw as EntityKind;
  return 'other';
}

function clampSpan(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function clampConfidence(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function mapEntities(
  raw: readonly RawEntity[] | undefined,
  detectedLanguage: string,
): DocIntelligenceLLMOutput['entities'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => typeof e.entityValue === 'string' && e.entityValue.trim() !== '')
    .map((e) => ({
      entityKind: coerceEntityKind(e.entityKind),
      entityValue: e.entityValue as string,
      ...(typeof e.entityRaw === 'string' ? { entityRaw: e.entityRaw } : {}),
      normalizedForm:
        e.normalizedForm && typeof e.normalizedForm === 'object'
          ? { ...e.normalizedForm }
          : {},
      languageCode: e.languageCode ?? detectedLanguage,
      spanStart: clampSpan(e.spanStart),
      spanEnd: clampSpan(e.spanEnd),
      confidence: clampConfidence(e.confidence),
    }));
}

function mapObligations(
  raw: readonly RawObligation[] | undefined,
  detectedLanguage: string,
): DocIntelligenceLLMOutput['obligations'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o) => typeof o.obligor === 'string' && o.obligor.trim() !== '')
    .map((o) => ({
      obligor: o.obligor as string,
      obligee: o.obligee ?? null,
      actionSummary:
        typeof o.actionSummary === 'string' ? o.actionSummary : '',
      dueDate: o.dueDate ?? null,
      recurrence: o.recurrence ?? null,
      consequenceIfMissed: o.consequenceIfMissed ?? null,
      riskFlags: Array.isArray(o.riskFlags)
        ? o.riskFlags.filter((f): f is string => typeof f === 'string')
        : [],
      languageCode: o.languageCode ?? detectedLanguage,
      spanStart: clampSpan(o.spanStart),
      spanEnd: clampSpan(o.spanEnd),
      confidence: clampConfidence(o.confidence),
      explanation: o.explanation ?? null,
    }));
}

/**
 * Build the Anthropic-backed doc-intelligence LLM port, bound to one
 * tenant. The PhL `DocIntelligenceLLMPort.extract` signature does not carry
 * `tenantId` (the extractor owns it), but the per-tenant budget-guarded
 * client must be constructed with the tenant id — so the route adapter
 * builds a fresh port per request with the calling tenant. This is
 * concurrency-safe: no shared mutable tenant state across requests.
 */
export function createDocIntelligenceLlmPort(
  buildClient: GuardedAnthropicFactory,
  tenantId: string,
): DocIntelligenceLLMPort {
  return {
    async extract(input) {
      const userPrompt = [
        input.languageHint ? `languageHint: ${input.languageHint}` : null,
        input.countryCode ? `countryCode: ${input.countryCode}` : null,
        'documentText:',
        input.text.slice(0, MAX_TEXT_CHARS),
      ]
        .filter((line): line is string => line !== null)
        .join('\n');

      const result = await callGuardedAnthropic(buildClient, {
        tenantId,
        operation: 'ai-native.doc-intelligence.extract',
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxTokens: MAX_TOKENS,
        temperature: 0,
      });

      const parsed = parseLlmJson<DocLlmJson>(result.text);
      if (!parsed) {
        throw new Error('doc-intelligence LLM returned unparseable JSON');
      }

      const detectedLanguage =
        typeof parsed.detectedLanguage === 'string' &&
        parsed.detectedLanguage.trim() !== ''
          ? parsed.detectedLanguage
          : (input.languageHint ?? 'und');

      return {
        detectedLanguage,
        entities: mapEntities(parsed.entities, detectedLanguage),
        obligations: mapObligations(parsed.obligations, detectedLanguage),
        modelVersion: result.modelVersion,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsdMicro: 0,
      };
    },
  };
}
