/**
 * Intent extraction port + reference impl.
 *
 * The port returns one of the closed `INTENT_KINDS` set. The reference
 * impl is a pattern-matching classifier — production hosts inject an
 * LLM-backed or dual-encoder-backed classifier via the same port.
 *
 * Closed ontology rationale: see spec §5 — cognitive-memory must be
 * able to index by intent without combinatorial explosion.
 *
 * Reference docs:
 *   - ZeroShot intent classifiers:
 *       https://huggingface.co/docs/transformers/tasks/zero_shot_classification
 *   - Dual-encoder retrievers (DPR, baseline still used 2026):
 *       https://arxiv.org/abs/2004.04906
 */

import type {
  Intent,
  IntentExtractorPort,
  RedactedText,
} from '../types.js';

export {
  type IntentExtractorPort,
} from '../types.js';

interface IntentRule {
  readonly intent: Intent;
  readonly keywords: ReadonlyArray<string>;
}

/**
 * Reference rules — Swahili + English mining-domain keywords. The
 * production impl will replace this with a finetuned dual-encoder
 * retriever; the keyword rules are an honest fallback while we collect
 * labeled data.
 */
export const REFERENCE_INTENT_RULES: ReadonlyArray<IntentRule> = [
  {
    intent: 'book_inspection',
    keywords: ['inspection', 'inspector', 'ukaguzi', 'kaguzi', 'nemc'],
  },
  {
    intent: 'report_incident',
    keywords: [
      'incident',
      'accident',
      'ajali',
      'tukio',
      'kuumia',
      'damage',
    ],
  },
  {
    intent: 'query_parcel_status',
    keywords: ['parcel', 'parseli', 'status', 'hali', 'gramu', 'gram'],
  },
  {
    intent: 'request_meeting',
    keywords: [
      'meeting',
      'mkutano',
      'tukutane',
      'schedule',
      'kalenda',
    ],
  },
  {
    intent: 'escalate_safety',
    keywords: [
      'safety',
      'usalama',
      'danger',
      'hatari',
      'evacuate',
      'okoa',
    ],
  },
];

/**
 * Build a reference intent extractor backed by `REFERENCE_INTENT_RULES`.
 * Returns the FIRST matching intent; falls through to 'other' when no
 * rule matches.
 */
export function createReferenceIntentExtractor(): IntentExtractorPort {
  return {
    extract(redacted: RedactedText): Promise<Intent> {
      const lc = redacted.text.toLowerCase();
      for (const rule of REFERENCE_INTENT_RULES) {
        for (const kw of rule.keywords) {
          if (lc.includes(kw.toLowerCase())) {
            return Promise.resolve(rule.intent);
          }
        }
      }
      return Promise.resolve('other' as Intent);
    },
  };
}
