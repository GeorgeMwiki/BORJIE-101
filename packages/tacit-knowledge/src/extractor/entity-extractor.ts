/**
 * Entity extractor — reference implementation.
 *
 * Wave HARVEST. The production extractor wires an LLM via
 * `@borjie/brain-llm-router` (Chain-of-Thought entity extraction over
 * a transcript chunk, per Anthropic 2025 guidance — the reasoning
 * text is treated as a probabilistic claim, not ground truth). The
 * reference implementation in this package emits deterministic
 * extractions from heuristic markers in the subject's turns:
 *
 *   - sentences containing the modal "always" or "never" → `pattern`
 *   - sentences containing "you have to" / "you must" → `rule`
 *   - sentences containing "the X is called" / "we call this" →
 *     `terminology`
 *   - sentences containing "what went wrong" / "the mistake" →
 *     `failure`
 *   - everything else with > 10 words from the subject → `fact`
 *
 * This shape lets tests assert the engine's orchestration without
 * needing a live LLM; production replaces the implementation behind
 * the same `EntityExtractor` port.
 */

import type {
  EntityExtractor,
  EntityKind,
  ExtractionDraft,
  ExtractionEntity,
  InterviewMode,
  TranscriptTurn,
} from '../types.js';

interface ExtractorOptions {
  readonly minWordsForFact: number;
  readonly defaultConfidence: number;
}

const DEFAULT_OPTIONS: ExtractorOptions = {
  minWordsForFact: 10,
  defaultConfidence: 0.65,
};

interface Marker {
  readonly kind: EntityKind;
  readonly patterns: ReadonlyArray<RegExp>;
  readonly confidence: number;
}

const MARKERS: ReadonlyArray<Marker> = [
  {
    kind: 'pattern',
    patterns: [/\b(always|never|every time)\b/i, /\bin this district\b/i],
    confidence: 0.78,
  },
  {
    kind: 'rule',
    patterns: [/\byou have to\b/i, /\byou must\b/i, /\bdon'?t\b.+\bunless\b/i],
    confidence: 0.82,
  },
  {
    kind: 'terminology',
    patterns: [/\bwe call (this|that|it)\b/i, /\bthe \w+ is called\b/i],
    confidence: 0.86,
  },
  {
    kind: 'failure',
    patterns: [
      /\bwhat went wrong\b/i,
      /\bthe mistake\b/i,
      /\bshould have\b/i,
      /\bdidn'?t (catch|notice|see)\b/i,
    ],
    confidence: 0.74,
  },
  {
    kind: 'preference',
    patterns: [/\bi prefer\b/i, /\bi like to\b/i, /\bi would rather\b/i],
    confidence: 0.7,
  },
];

function classify(text: string): { kind: EntityKind; confidence: number } | null {
  for (const marker of MARKERS) {
    for (const pattern of marker.patterns) {
      if (pattern.test(text)) {
        return { kind: marker.kind, confidence: marker.confidence };
      }
    }
  }
  return null;
}

function splitSentences(text: string): ReadonlyArray<string> {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

export function createReferenceEntityExtractor(
  options: Partial<ExtractorOptions> = {},
): EntityExtractor {
  const opts: ExtractorOptions = { ...DEFAULT_OPTIONS, ...options };

  return {
    async extract(input: {
      readonly tenantId: string;
      readonly mode: InterviewMode;
      readonly chunk: ReadonlyArray<TranscriptTurn>;
    }): Promise<ReadonlyArray<ExtractionDraft>> {
      const drafts: ExtractionDraft[] = [];
      input.chunk.forEach((turn, turnIndex) => {
        if (turn.speaker !== 'subject') return;
        const sentences = splitSentences(turn.text);
        sentences.forEach((sentence) => {
          const classification = classify(sentence);
          let kind: EntityKind;
          let confidence: number;
          if (classification !== null) {
            kind = classification.kind;
            confidence = classification.confidence;
          } else if (wordCount(sentence) >= opts.minWordsForFact) {
            kind = 'fact';
            confidence = opts.defaultConfidence;
          } else {
            return;
          }
          const entity: ExtractionEntity = Object.freeze({
            text: sentence,
            structured: Object.freeze({
              mode: input.mode,
              turnIndex,
              wordCount: wordCount(sentence),
            }),
            citations: Object.freeze([
              { span: sentence, turnIndex },
            ]),
          });
          drafts.push(
            Object.freeze({
              entityKind: kind,
              entity,
              confidence,
              novel: true,
            }),
          );
        });
      });
      return Object.freeze(drafts);
    },
  };
}
