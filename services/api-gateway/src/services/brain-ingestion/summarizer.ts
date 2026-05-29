/**
 * Bilingual digest generator — renders a Markdown summary in EN + SW for
 * each ingested doc. Always returns a non-empty Summary even when the
 * LLM is unavailable (degrades to a deterministic structural digest).
 *
 * Wave COMPANY-BRAIN (C-1).
 */

import type { ParsedDoc, Summary } from './types.js';
import { callBrainOnce } from '../../routes/owner/brain-call.js';

const SUMMARY_SYSTEM_PROMPT = `You are Mr. Mwikila, founder-mode operator of a Tanzanian mining estate.

You just received a new document the owner uploaded. Produce a tight
digest in BOTH English and Swahili, plus 3-7 key facts.

Output STRICT JSON only — no markdown fences, no commentary:

{
  "summary_md":  "<bilingual markdown digest, EN first then SW, ~150 words each>",
  "summary_en":  "<English-only summary, 2-3 paragraphs>",
  "summary_sw":  "<Swahili-only summary, 2-3 paragraphs>",
  "key_facts": [
    {"kind": "entity.name|date|amount|location|...", "value": "<short literal>", "confidence": 0.0-1.0}
  ]
}

Rules:
- Never invent. If a fact isn't in the doc, omit it.
- Use the EXACT numbers / dates / names from the text.
- Default to TZS for monetary amounts unless the doc says otherwise.
- Keep each summary under 200 words.
- key_facts: 3 minimum, 7 maximum.
`;

interface ParsedSummary {
  summary_md?: string;
  summary_en?: string;
  summary_sw?: string;
  key_facts?: Array<{ kind?: string; value?: string; confidence?: number }>;
}

function safeJson(raw: string): ParsedSummary | null {
  try {
    // Tolerate the model wrapping JSON in a fence.
    const fence = raw.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
    const body = fence ? fence[1]! : raw.trim();
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as ParsedSummary;
    }
    return null;
  } catch {
    return null;
  }
}

function deterministicFallback(
  doc: ParsedDoc,
  filename: string,
  sourceKind: string,
): Summary {
  const head = doc.text.slice(0, 400).trim();
  const sumEn = `Borjie ingested ${filename} (${sourceKind}). Preview: ${
    head || '(empty extract)'
  }`;
  const sumSw = `Borjie imeingiza ${filename} (${sourceKind}). Mfano: ${
    head || '(hakuna maandishi)'
  }`;
  return Object.freeze({
    summaryMd: `**EN** — ${sumEn}\n\n**SW** — ${sumSw}`,
    summaryEn: sumEn,
    summarySw: sumSw,
    keyFacts: doc.extractedFacts,
  });
}

export interface SummariseInput {
  readonly tenantId: string;
  readonly filename: string;
  readonly sourceKind: string;
  readonly parsed: ParsedDoc;
}

export async function summariseDoc(input: SummariseInput): Promise<Summary> {
  const { parsed, filename, sourceKind } = input;
  // Cap user-prompt size so a 1MB CSV doesn't blow the context budget.
  const trimmed = parsed.text.length > 12000
    ? `${parsed.text.slice(0, 6000)}\n\n... [middle truncated for summarisation] ...\n\n${parsed.text.slice(-3000)}`
    : parsed.text;

  const userPrompt = [
    `Document: ${filename}`,
    `Type: ${sourceKind}`,
    `Detected language: ${parsed.detectedLanguage}`,
    '',
    '--- CONTENT START ---',
    trimmed,
    '--- CONTENT END ---',
  ].join('\n');

  try {
    const reply = await callBrainOnce({
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 900,
    });
    const parsedJson = safeJson(reply.text);
    if (!parsedJson) {
      return deterministicFallback(parsed, filename, sourceKind);
    }
    const summaryEn = (parsedJson.summary_en ?? '').trim();
    const summarySw = (parsedJson.summary_sw ?? '').trim();
    const summaryMd =
      (parsedJson.summary_md ?? '').trim() ||
      `**EN** — ${summaryEn}\n\n**SW** — ${summarySw}`;
    if (!summaryEn || !summarySw) {
      return deterministicFallback(parsed, filename, sourceKind);
    }
    const rawFacts = Array.isArray(parsedJson.key_facts)
      ? parsedJson.key_facts
      : [];
    const keyFacts = rawFacts
      .filter((f) => typeof f?.kind === 'string' && typeof f?.value === 'string')
      .slice(0, 7)
      .map((f) =>
        Object.freeze({
          kind: String(f.kind),
          value: String(f.value),
          confidence:
            typeof f.confidence === 'number' &&
            f.confidence >= 0 &&
            f.confidence <= 1
              ? f.confidence
              : 0.6,
        }),
      );
    return Object.freeze({
      summaryMd,
      summaryEn,
      summarySw,
      keyFacts: Object.freeze(keyFacts),
    });
  } catch {
    // Degrades silently to the deterministic fallback so the ingest
    // lifecycle still completes (memory-durability promise).
    return deterministicFallback(parsed, filename, sourceKind);
  }
}
