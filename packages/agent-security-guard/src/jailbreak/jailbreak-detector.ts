/**
 * Jailbreak detector — many-shot, DAN-family, GCG-suffix.
 *
 * Sources:
 *   - Anil et al. 2024, "Many-shot Jailbreaking": https://arxiv.org/abs/2404.02151
 *   - Zou et al. 2023, GCG: https://arxiv.org/abs/2307.15043
 *   - Wei et al. 2024, "Jailbroken: How Does LLM Safety Training Fail?":
 *       https://arxiv.org/abs/2402.06363
 *
 * Conservative: we only flag *strong* signals, never single weak ones.
 * Many-shot needs >=8 fake-turn delimiters; GCG suffix needs >=40
 * adjacent non-natural-language characters at the *end* of the input.
 */
import type { InjectionKind, Severity } from '../types.js';

export interface JailbreakSignal {
  readonly kind: Extract<
    InjectionKind,
    'jailbreak-many-shot' | 'jailbreak-dan' | 'jailbreak-gcg-suffix'
  >;
  readonly severity: Severity;
  readonly evidence: string;
}

export interface JailbreakDetectionResult {
  readonly detected: boolean;
  readonly highestSeverity: Severity | null;
  readonly signals: ReadonlyArray<JailbreakSignal>;
}

// --- Many-shot detection -----------------------------------------------------

/**
 * Count fake-turn delimiters (User:, Assistant:, Human:, ###, <|im_start|>)
 * within a single message. Many-shot attacks stack many faked turns so
 * the assistant continues a poisoned distribution.
 */
const FAKE_TURN_REGEXES: ReadonlyArray<RegExp> = Object.freeze([
  /^\s*user\s*:/gim,
  /^\s*assistant\s*:/gim,
  /^\s*human\s*:/gim,
  /^\s*ai\s*:/gim,
  /^\s*###\s+/gm,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
]);

const MANY_SHOT_THRESHOLD = 8;

function countFakeTurns(text: string): number {
  let total = 0;
  for (const regex of FAKE_TURN_REGEXES) {
    const matches = text.match(regex);
    total += matches === null ? 0 : matches.length;
  }
  return total;
}

// --- DAN-family detection ----------------------------------------------------

const DAN_PATTERNS: ReadonlyArray<{
  readonly regex: RegExp;
  readonly label: string;
}> = Object.freeze([
  { regex: /\bDAN\b.*\bdo\s+anything\s+now\b/i, label: 'dan-classic' },
  { regex: /do\s+anything\s+now/i, label: 'dan-spelled' },
  { regex: /\bSTAN\b.*\bstrive\s+to\s+avoid\s+norms\b/i, label: 'stan' },
  { regex: /\bDUDE\b.*\bunlimited\b/i, label: 'dude' },
  { regex: /developer\s+mode\s+(?:enabled|on|activated)/i, label: 'dev-mode' },
  { regex: /jailbreak\s+(?:prompt|mode|activate)/i, label: 'jailbreak-self-label' },
  {
    regex: /\bAIM\b.*\balways\s+intelligent\s+(?:and\s+)?machiavellian\b/i,
    label: 'aim',
  },
  { regex: /opposite\s+day\s+(?:mode|protocol)/i, label: 'opposite-day' },
]);

// --- GCG suffix detection ----------------------------------------------------

/**
 * Detect long runs of non-natural-language characters at the end of the
 * input. GCG attacks craft a 40-100 char adversarial suffix maximising
 * the probability of an affirmative response.
 */
const GCG_MIN_LEN = 40;
const NATURAL_RUN = /[A-Za-z]{4,}/;

function detectGcgSuffix(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < GCG_MIN_LEN) return null;
  // Take the last 120 chars
  const tail = trimmed.slice(Math.max(0, trimmed.length - 120));
  // Strip leading natural-language words; whatever remains as a contiguous
  // tail without natural runs is the candidate suffix.
  // Specifically: count the longest tail substring with no 4+ letter run.
  let suffixStart = tail.length;
  while (suffixStart > 0) {
    const candidate = tail.slice(suffixStart - 1);
    if (NATURAL_RUN.test(candidate)) break;
    suffixStart -= 1;
  }
  const suffix = tail.slice(suffixStart);
  if (suffix.length < GCG_MIN_LEN) return null;
  // Must contain at least one non-alphanumeric oddball to look adversarial.
  if (!/[!@#$%^&*+=<>~|\\/{}\[\]"`]/.test(suffix)) return null;
  return suffix;
}

// --- Public API --------------------------------------------------------------

export interface JailbreakDetector {
  readonly detect: (text: string) => JailbreakDetectionResult;
}

export function createJailbreakDetector(): JailbreakDetector {
  function detect(text: string): JailbreakDetectionResult {
    if (typeof text !== 'string' || text.length === 0) {
      return Object.freeze({
        detected: false,
        highestSeverity: null,
        signals: Object.freeze([]),
      });
    }

    const signals: JailbreakSignal[] = [];

    const fakeTurns = countFakeTurns(text);
    if (fakeTurns >= MANY_SHOT_THRESHOLD) {
      signals.push(
        Object.freeze({
          kind: 'jailbreak-many-shot',
          severity: 'high' as Severity,
          evidence: `fake-turn-count=${fakeTurns}`,
        }),
      );
    }

    for (const { regex, label } of DAN_PATTERNS) {
      if (regex.test(text)) {
        signals.push(
          Object.freeze({
            kind: 'jailbreak-dan',
            severity: 'high' as Severity,
            evidence: label,
          }),
        );
        break;
      }
    }

    const gcg = detectGcgSuffix(text);
    if (gcg !== null) {
      signals.push(
        Object.freeze({
          kind: 'jailbreak-gcg-suffix',
          severity: 'high' as Severity,
          evidence: `gcg-suffix-len=${gcg.length}`,
        }),
      );
    }

    const highest: Severity | null = signals.length > 0 ? 'high' : null;

    return Object.freeze({
      detected: signals.length > 0,
      highestSeverity: highest,
      signals: Object.freeze(signals),
    });
  }

  return Object.freeze({ detect });
}
