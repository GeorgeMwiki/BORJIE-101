/**
 * Indirect-prompt-injection detector (LLM01 + LLM08).
 *
 * Operates on **retrieved content** — tool outputs, RAG chunks, file
 * uploads. Unlike the direct detector, this one *strips* offending
 * payloads in-line so the surrounding document can still be consumed
 * by the model.
 *
 * Sources:
 *   - Greshake et al. 2023, "Not what you've signed up for" (foundational paper)
 *   - Willison 2023, "Dual LLM pattern" (mitigation reference)
 *   - Rehberger 2023, "Markdown image prompt injection exfiltration"
 */
import {
  INDIRECT_INJECTION_PATTERNS,
  ZERO_WIDTH_REGEX,
} from './prompt-injection-patterns.js';
import type {
  DetectionMatch,
  PromptInjectionDetectionResult,
} from './prompt-injection-detector.js';
import type { Severity } from '../types.js';

const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
});

function maxSeverity(a: Severity | null, b: Severity | null): Severity | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export interface IndirectInjectionScanInput {
  readonly source: string;
  readonly text: string;
}

export interface IndirectInjectionDetector {
  readonly scan: (input: IndirectInjectionScanInput) => PromptInjectionDetectionResult;
}

export function createIndirectInjectionDetector(): IndirectInjectionDetector {
  function scan(
    input: IndirectInjectionScanInput,
  ): PromptInjectionDetectionResult {
    if (typeof input.text !== 'string' || input.text.length === 0) {
      return Object.freeze({
        detected: false,
        highestSeverity: null,
        matches: Object.freeze([]),
        redactedInput: '',
      });
    }

    const matches: DetectionMatch[] = [];
    let highest: Severity | null = null;
    let cleaned = input.text;

    for (const pattern of INDIRECT_INJECTION_PATTERNS) {
      const globalRegex = new RegExp(pattern.regex.source, `${pattern.regex.flags}g`);
      let found = false;
      let firstMatch: string | null = null;
      cleaned = cleaned.replace(globalRegex, (m) => {
        found = true;
        if (firstMatch === null) firstMatch = m;
        return '[REDACTED:INDIRECT-INJECTION]';
      });
      if (found) {
        matches.push(
          Object.freeze({
            kind: pattern.kind,
            severity: pattern.severity,
            label: pattern.label,
            excerpt: (firstMatch ?? '').slice(0, 200),
          }),
        );
        highest = maxSeverity(highest, pattern.severity);
      }
    }

    if (ZERO_WIDTH_REGEX.test(cleaned)) {
      matches.push(
        Object.freeze({
          kind: 'indirect-zero-width',
          severity: 'high',
          label: 'zero-width-payload',
          excerpt: '[zero-width characters]',
        }),
      );
      highest = maxSeverity(highest, 'high');
      cleaned = cleaned.replace(/[​‌‍﻿‮]/gu, '');
    }

    return Object.freeze({
      detected: matches.length > 0,
      highestSeverity: highest,
      matches: Object.freeze(matches),
      redactedInput: cleaned,
    });
  }

  return Object.freeze({ scan });
}
