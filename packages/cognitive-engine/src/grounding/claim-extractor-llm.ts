/**
 * R17 — RAG citation-claim extractor LLM lift (G-FIX-2).
 *
 * Wraps the deterministic `classifySentences` heuristic from
 * `./claim-extractor.ts` with a real LLM call that re-classifies the
 * borderline sentences the heuristic is least confident about. The LLM
 * is asked to return ONLY the is_claim flag per sentence plus the list
 * of citation markers it spots — it never invents markers.
 *
 * The wrapper is provider-agnostic at the TYPE level — it accepts a
 * `ClaimLlmClient` mirroring the Anthropic Messages SDK
 * `messages.create` shape so the @anthropic-ai/sdk import stays out
 * of cognitive-engine. The api-gateway composition root binds a real
 * Anthropic client; tests inject a hand-rolled stub.
 *
 * Per CLAUDE.md grounding rule:
 *   - Output MUST be JSON. Markers MUST be a subset of the markers
 *     already present in the text. The LLM is NEVER allowed to invent
 *     new citation IDs — that would defeat the whole point of the
 *     cite-validator (KI-cite-validator-spec §5 step 4 = "faked").
 *   - On LLM failure / shape violation / fabricated markers, the
 *     wrapper logs a Pino-shaped `warn` and falls back to the
 *     deterministic heuristic.
 *
 * @module @borjie/cognitive-engine/grounding/claim-extractor-llm
 */

import {
  classifySentences,
  extractMarkers,
  splitSentences,
  type ClassifiedSentence,
  type Sentence,
} from './claim-extractor.js';

// ---------------------------------------------------------------------------
// Provider-agnostic LLM types (mirror Anthropic Messages API shape)
// ---------------------------------------------------------------------------

export interface ClaimLlmCacheControl {
  readonly type: 'ephemeral';
}

const EPHEMERAL_CACHE: ClaimLlmCacheControl = Object.freeze({
  type: 'ephemeral',
});

export interface ClaimLlmTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: ClaimLlmCacheControl;
}

export interface ClaimLlmRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly temperature?: number;
  readonly system?: string | ReadonlyArray<ClaimLlmTextBlock>;
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
}

export interface ClaimLlmResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

export interface ClaimLlmClient {
  readonly model: string;
  readonly messages: {
    create(req: ClaimLlmRequest): Promise<ClaimLlmResponse>;
  };
}

// ---------------------------------------------------------------------------
// Pino-shaped logger surface (subset)
// ---------------------------------------------------------------------------

export interface ClaimLogger {
  warn(meta: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ClassifySentencesWithLlmOptions {
  readonly client: ClaimLlmClient | null;
  readonly logger?: ClaimLogger | undefined;
  readonly modelOverride?: string | undefined;
  readonly maxBorderlineSentences?: number;
}

/**
 * Run the deterministic classifier, then ask the LLM to re-judge the
 * sentences the heuristic marked as borderline (no claim signals AND
 * no hedge tokens — the regex was silent on them). Falls back to the
 * heuristic on any error / shape violation / fabricated markers.
 *
 * Pass `client: null` to short-circuit straight to the heuristic
 * (covers the no-ANTHROPIC_API_KEY mode).
 */
export async function classifySentencesWithLlm(
  text: string,
  options: ClassifySentencesWithLlmOptions,
): Promise<ReadonlyArray<ClassifiedSentence>> {
  const heuristic = classifySentences(text);
  if (!options.client) {
    return heuristic;
  }

  const sentences = splitSentences(text);
  if (sentences.length === 0) return heuristic;

  const borderline = pickBorderline(heuristic, options.maxBorderlineSentences ?? 12);
  if (borderline.length === 0) {
    return heuristic;
  }

  try {
    const refined = await callLlm({
      client: options.client,
      model:
        options.modelOverride
        ?? options.client.model,
      sentences: borderline.map((b) => ({ index: b.index, text: b.text })),
    });
    if (refined.length === 0) return heuristic;

    // Build a quick lookup of every marker found by the regex per
    // sentence — the LLM must NEVER introduce new ones.
    const allowedByIndex = new Map<number, ReadonlyArray<string>>();
    for (const s of heuristic) {
      allowedByIndex.set(s.index, s.citation_markers);
    }
    const merged: Array<ClassifiedSentence> = [];
    for (const s of heuristic) {
      const r = refined.find((x) => x.index === s.index);
      if (!r) {
        merged.push(s);
        continue;
      }
      // Verify the LLM did not invent markers; if it did, drop the LLM
      // judgement for this sentence and keep the heuristic.
      const allowed = new Set(extractMarkers(s.text));
      const llmInventedMarker = r.citation_markers.some(
        (m) => !allowed.has(m),
      );
      if (llmInventedMarker) {
        options.logger?.warn(
          {
            path: 'rag-citation-r17',
            sentenceIndex: s.index,
            invented: r.citation_markers.filter((m) => !allowed.has(m)),
          },
          'brain LLM invented citation markers — keeping heuristic verdict',
        );
        merged.push(s);
        continue;
      }
      merged.push({
        ...s,
        is_claim: r.is_claim,
        citation_markers: s.citation_markers,
      });
    }
    return merged;
  } catch (err) {
    options.logger?.warn(
      { err, path: 'rag-citation-r17' },
      'brain LLM call failed — falling back to deterministic claim classifier',
    );
    return heuristic;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface BorderlineSentence {
  readonly index: number;
  readonly text: string;
}

interface LlmRefinedSentence {
  readonly index: number;
  readonly is_claim: boolean;
  readonly citation_markers: ReadonlyArray<string>;
}

/**
 * Heuristic chose `is_claim = false` because no number / year /
 * stat-phrase / named authority matched, but the sentence is long
 * enough to plausibly be a claim. Those are the borderline candidates
 * — we ask the LLM to make the final call. Hedged sentences and
 * confirmed-claim sentences are stable; we never burn tokens on them.
 */
function pickBorderline(
  heuristic: ReadonlyArray<ClassifiedSentence>,
  maxN: number,
): ReadonlyArray<BorderlineSentence> {
  const borderline: Array<BorderlineSentence> = [];
  for (const s of heuristic) {
    if (s.is_claim) continue;
    if (s.text.length < 40) continue; // too short to matter
    const lower = s.text.toLowerCase();
    if (
      lower.includes('should')
      || lower.includes('might')
      || lower.includes('could')
      || lower.includes('maybe')
      || lower.includes('i recommend')
      || lower.includes('i suggest')
    ) {
      continue;
    }
    borderline.push({ index: s.index, text: s.text });
    if (borderline.length >= maxN) break;
  }
  return borderline;
}

const SYSTEM_PROMPT = [
  'You are Borjie\'s grounding gate. For each sentence supplied,',
  'decide if it is a FACTUAL CLAIM that the upstream auditor must',
  'verify against evidence. Return JSON ONLY:',
  '',
  '{ "results": [ { "index": <int>, "is_claim": <bool>,',
  '                 "citation_markers": [<existing markers only>] } ] }',
  '',
  'Hard rules:',
  '- A factual claim is a statement that can be verified against a',
  '  source document (number, year, named authority, specific',
  '  attribution, quantitative comparison).',
  '- A non-claim is an opinion, recommendation, hedge, or generic',
  '  framing.',
  '- citation_markers MUST be a subset of `[cit_*]` markers already',
  '  present in the source sentence text. You MUST NEVER invent or',
  '  reword a marker. If a sentence has no markers, return an empty',
  '  array.',
  '- Preserve the sentence indexes verbatim.',
  '- Do not add prose, do not wrap the JSON in markdown fences.',
].join('\n');

interface CallLlmArgs {
  readonly client: ClaimLlmClient;
  readonly model: string;
  readonly sentences: ReadonlyArray<BorderlineSentence>;
}

async function callLlm(
  args: CallLlmArgs,
): Promise<ReadonlyArray<LlmRefinedSentence>> {
  const userPrompt = JSON.stringify(
    {
      sentences: args.sentences.map((s) => ({
        index: s.index,
        text: s.text,
      })),
    },
    null,
    2,
  );
  const response = await args.client.messages.create({
    model: args.model,
    max_tokens: 1024,
    temperature: 0.0,
    // Ephemeral cache_control breakpoint on the SHARED system prompt
    // — see Anthropic prompt caching docs. Multi-turn RAG sessions
    // hit this prefix repeatedly so the savings stack.
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: EPHEMERAL_CACHE,
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = extractText(response);
  const candidate = stripFences(text).trim();
  if (!candidate) {
    throw new Error('Claim LLM returned empty content (no JSON to parse)');
  }
  const parsed = JSON.parse(candidate) as unknown;
  if (!isClaimLlmResponse(parsed)) {
    throw new Error(
      'Claim LLM response did not match the expected JSON shape',
    );
  }
  return parsed.results;
}

function extractText(response: ClaimLlmResponse): string {
  if (!Array.isArray(response.content)) return '';
  return response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

function stripFences(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '') : raw;
}

interface ParsedShape {
  readonly results: ReadonlyArray<LlmRefinedSentence>;
}

function isClaimLlmResponse(value: unknown): value is ParsedShape {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v['results'])) return false;
  for (const r of v['results']) {
    if (typeof r !== 'object' || r === null) return false;
    const rr = r as Record<string, unknown>;
    if (typeof rr['index'] !== 'number') return false;
    if (typeof rr['is_claim'] !== 'boolean') return false;
    if (!Array.isArray(rr['citation_markers'])) return false;
    for (const m of rr['citation_markers']) {
      if (typeof m !== 'string') return false;
    }
  }
  return true;
}

// Reserve splitSentences/Sentence imports so the module remains
// a clean re-export surface for downstream callers.
void splitSentences;
export type { Sentence };
