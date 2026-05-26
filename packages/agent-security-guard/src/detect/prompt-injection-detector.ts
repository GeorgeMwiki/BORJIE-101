/**
 * Direct-prompt-injection detector (LLM01).
 *
 * Pattern-based first-pass over the curated corpus in
 * `prompt-injection-patterns.ts`. Optionally calls an injected
 * LLM-judge ensemble (port) for borderline / novel attacks.
 *
 * Returns a deterministic, immutable result. Never throws on regex —
 * regex failures degrade to "no match".
 */
import {
  DIRECT_INJECTION_PATTERNS,
  ZERO_WIDTH_REGEX,
  type PromptInjectionPattern,
} from './prompt-injection-patterns.js';
import type {
  AgentChannel,
  InjectionKind,
  Severity,
} from '../types.js';

export interface DetectionMatch {
  readonly kind: InjectionKind;
  readonly severity: Severity;
  readonly label: string;
  readonly excerpt: string;
}

export interface PromptInjectionDetectionResult {
  readonly detected: boolean;
  readonly highestSeverity: Severity | null;
  readonly matches: ReadonlyArray<DetectionMatch>;
  readonly redactedInput: string;
}

export interface LlmJudgeVerdict {
  readonly isAttack: boolean;
  readonly kind: InjectionKind | null;
  readonly severity: Severity | null;
  readonly rationale: string;
}

/**
 * Port for an optional LLM-judge ensemble. Production composition wires
 * this to `brain-llm-router` cheap-tier. Off by default for unit tests
 * (live-test discipline — no remote calls in unit tests).
 */
export interface LlmJudgePort {
  readonly judge: (input: {
    readonly channel: AgentChannel;
    readonly text: string;
  }) => Promise<LlmJudgeVerdict>;
}

export interface PromptInjectionDetectorDeps {
  readonly patterns?: ReadonlyArray<PromptInjectionPattern>;
  readonly llmJudge?: LlmJudgePort;
}

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

function redactSpan(text: string, match: RegExpExecArray): string {
  const start = match.index;
  const end = match.index + match[0].length;
  return (
    text.slice(0, start) +
    '[REDACTED:INJECTION]' +
    text.slice(end)
  );
}

export interface PromptInjectionDetector {
  readonly detect: (input: {
    readonly channel: AgentChannel;
    readonly text: string;
  }) => Promise<PromptInjectionDetectionResult>;
  readonly detectSync: (input: {
    readonly channel: AgentChannel;
    readonly text: string;
  }) => PromptInjectionDetectionResult;
}

export function createPromptInjectionDetector(
  deps: PromptInjectionDetectorDeps = {},
): PromptInjectionDetector {
  const patterns = deps.patterns ?? DIRECT_INJECTION_PATTERNS;

  function detectSync(input: {
    readonly channel: AgentChannel;
    readonly text: string;
  }): PromptInjectionDetectionResult {
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
    let redacted = input.text;

    for (const pattern of patterns) {
      const execResult = new RegExp(pattern.regex.source, pattern.regex.flags).exec(
        input.text,
      );
      if (execResult === null) continue;
      const excerpt = execResult[0].slice(0, 200);
      matches.push(
        Object.freeze({
          kind: pattern.kind,
          severity: pattern.severity,
          label: pattern.label,
          excerpt,
        }),
      );
      highest = maxSeverity(highest, pattern.severity);
      redacted = redactSpan(redacted, execResult);
    }

    // Zero-width character payload (hidden injection)
    if (ZERO_WIDTH_REGEX.test(input.text)) {
      matches.push(
        Object.freeze({
          kind: 'indirect-zero-width',
          severity: 'high',
          label: 'zero-width-payload',
          excerpt: '[zero-width characters]',
        }),
      );
      highest = maxSeverity(highest, 'high');
      redacted = redacted.replace(
        /[​‌‍﻿‮]/gu,
        '',
      );
    }

    return Object.freeze({
      detected: matches.length > 0,
      highestSeverity: highest,
      matches: Object.freeze(matches),
      redactedInput: redacted,
    });
  }

  async function detect(input: {
    readonly channel: AgentChannel;
    readonly text: string;
  }): Promise<PromptInjectionDetectionResult> {
    const baseline = detectSync(input);
    if (deps.llmJudge === undefined) return baseline;

    // If pattern detector already found a CRITICAL match, no need to
    // pay for the LLM judge.
    if (baseline.highestSeverity === 'critical') return baseline;

    try {
      const verdict = await deps.llmJudge.judge(input);
      if (!verdict.isAttack) return baseline;
      const judgeKind: InjectionKind = verdict.kind ?? 'role-play-override';
      const judgeSeverity: Severity = verdict.severity ?? 'medium';
      const judgeMatch: DetectionMatch = Object.freeze({
        kind: judgeKind,
        severity: judgeSeverity,
        label: 'llm-judge',
        excerpt: verdict.rationale.slice(0, 200),
      });
      return Object.freeze({
        detected: true,
        highestSeverity: maxSeverity(baseline.highestSeverity, judgeSeverity),
        matches: Object.freeze([...baseline.matches, judgeMatch]),
        redactedInput: baseline.redactedInput,
      });
    } catch {
      // LLM judge failure must NOT break the security pipeline; we
      // fall back to the pattern-baseline. Failures are surfaced via
      // observability sink upstream.
      return baseline;
    }
  }

  return Object.freeze({ detect, detectSync });
}
