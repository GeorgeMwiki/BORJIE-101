/**
 * Conversational repair detector.
 *
 * The brain's analogue to "wait, hang on, I meant the OTHER one" —
 * a fast inbound-turn scan for explicit-disagreement signals from the
 * user. When triggered, the kernel short-circuits the normal pipeline
 * with an apology + re-grounding prompt rather than re-running the
 * full sensor / memory / cohort stack against a user who already told
 * us we got it wrong. Mirror image of the uncertainty-policy gate, but
 * driven by user pushback instead of internal confidence.
 *
 * Pure / dependency-free. The kernel uses the verdict to decide whether
 * to swap the system prompt for a repair-mode prompt before the sensor
 * call.
 *
 * Detection is regex-based and intentionally narrow: false positives
 * here are expensive (the kernel will skip cohort + memory recall and
 * present an apology to a user who didn't actually push back). Better
 * to miss a quiet correction and let the next turn's affective signal
 * pick it up than to apologise spuriously.
 */

/**
 * The repair signal the detector matched on. Carried in the verdict so
 * the kernel + the audit trail can name the trigger explicitly.
 */
export type RepairSignal =
  | 'explicit-no'
  | 'wait-stop'
  | 'thats-wrong'
  | 'i-meant'
  | 'misunderstood';

export interface RepairVerdict {
  readonly triggered: boolean;
  readonly signal: RepairSignal | null;
  /**
   * The phrase the user used to correct — captured verbatim so the
   * kernel can echo it back ("you said 'the other lease' — let me
   * re-check"). Falls back to the trigger text when no capture is
   * available.
   */
  readonly originalIntent: string | null;
}

/**
 * Regex patterns, ordered most-specific first. Order matters — the
 * detector returns on first match so a long-form correction
 * ("I meant the OTHER lease") wins over the bare "no" inside the
 * same sentence.
 *
 * `\bno\b` is restricted to opening position (start-of-message or
 * after sentence boundary) so "noted", "no problem", "I'd say no but
 * actually yes" don't trip the gate; only "no, that's wrong" /
 * "no, I meant …" / "no — wait" do.
 */
const PATTERNS: ReadonlyArray<{ signal: RepairSignal; re: RegExp }> = [
  {
    signal: 'i-meant',
    re: /\bI\s+meant\b[^.!?\n]*/i,
  },
  {
    signal: 'misunderstood',
    re: /\b(?:you )?misunderstood\b[^.!?\n]*/i,
  },
  {
    signal: 'thats-wrong',
    re: /\bthat'?s\s+(?:wrong|not\s+what)\b[^.!?\n]*/i,
  },
  {
    signal: 'wait-stop',
    re: /\b(?:wait|stop|hold on|hang on)\b[^.!?\n]*/i,
  },
  {
    signal: 'explicit-no',
    re: /(?:^|[.!?]\s+)no\b[^.!?\n]*/i,
  },
];

/**
 * Words that look like "no" but aren't pushback. The detector strips
 * these BEFORE applying PATTERNS so "noted" / "no problem" /
 * "no worries" / "i know" never trip the gate.
 */
const NOT_PUSHBACK = [
  /\bnoted\b/gi,
  /\bnone\b/gi,
  /\bnobody\b/gi,
  /\bnotice\w*/gi,
  /\bnothing\b/gi,
  /\bnow\b/gi,
  /\bno\s+(?:problem|worries|biggie|sweat|rush|need|thanks|thank you)\b/gi,
  /\bi\s+know\b/gi,
];

/**
 * Run the repair scan against the inbound user turn.
 *
 * Returns `{triggered: false}` when no signal matched; returns
 * `{triggered: true, signal, originalIntent}` when one does. The
 * verdict is the kernel's input to step 6.5 — when triggered, the
 * kernel swaps the sensor system prompt for a repair-mode prompt that
 * asks the user to re-state their intent and acknowledges the miss.
 */
export function detectRepair(userMessage: string): RepairVerdict {
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return EMPTY;
  }

  // Mask the not-pushback fragments before pattern matching so they
  // don't survive into a regex like `\bno\b`.
  let scrubbed = userMessage;
  for (const re of NOT_PUSHBACK) {
    scrubbed = scrubbed.replace(re, (m) => '_'.repeat(m.length));
  }

  for (const { signal, re } of PATTERNS) {
    const match = re.exec(scrubbed);
    if (match) {
      // Walk the ORIGINAL text using the matched span so the captured
      // phrase keeps the user's verbatim casing for the echo-back.
      const captured = userMessage.slice(
        match.index,
        match.index + match[0].length,
      );
      return {
        triggered: true,
        signal,
        originalIntent: captured.trim() || null,
      };
    }
  }

  return EMPTY;
}

const EMPTY: RepairVerdict = {
  triggered: false,
  signal: null,
  originalIntent: null,
};

/**
 * Render the repair-mode addendum the kernel mixes into the system
 * prompt when `detectRepair` triggers. Keeps the language tight —
 * apology + name the miss + ask the user to re-ground us. Mirrors the
 * uncertainty-policy `ask-back` wording, but acknowledges the user
 * already pushed back rather than the brain admitting low confidence.
 */
export function renderRepairDirective(verdict: RepairVerdict): string {
  if (!verdict.triggered) return '';
  const echo = verdict.originalIntent
    ? `You said: "${verdict.originalIntent}". `
    : '';
  return [
    '[CONVERSATIONAL REPAIR — user pushed back]',
    `${echo}I missed something on the previous turn. This turn:`,
    '- Open with a brief acknowledgement ("I hear you — let me re-check.").',
    '- Do NOT defend the previous answer. Drop it.',
    '- Re-state what I now believe the user meant in one sentence and ask the user to confirm before I run any new tool call.',
    '- No new claims this turn until the user confirms the re-grounding.',
    '[END CONVERSATIONAL REPAIR]',
  ].join('\n');
}
