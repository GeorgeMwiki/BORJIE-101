/**
 * AI suggestion chip — bilingual copy + confidence-routing for the
 * "Borjie suggests X" pattern across dispatch / assignment UIs.
 *
 * Closes G6 in `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md` — wires the
 * pattern from `Docs/RESEARCH/manager-dispatch-sota.md` §6:
 *
 *   sw: "Borjie inapendekeza João · 87%"
 *   en: "Borjie suggests João · 87%"
 *
 * Routing thresholds match the dispatch SOTA:
 *
 *   - confidence >= 0.90  → 'pre-fill'  (one-tap confirm)
 *   - 0.70 <= c < 0.90    → 'top-three' (show top-3, manager picks)
 *   - c < 0.70            → 'no-suggestion' (manager from scratch)
 *
 * Pure module — no UI, no React, no DB. Caller renders the chip.
 */

export type AiSuggestionRoute = 'pre-fill' | 'top-three' | 'no-suggestion'

export interface AiSuggestionChipInput {
  readonly suggestionLabel: string
  /** 0..1 confidence score from the AI router. */
  readonly confidence: number
  readonly lang: 'sw' | 'en'
  /** Optional short reason rendered after the percentage. */
  readonly reason?: string
}

export interface AiSuggestionChipText {
  readonly text: string
  readonly route: AiSuggestionRoute
  /** Percentage rendered in the chip (integer 0..100). */
  readonly percent: number
}

/** Lower bound to render a chip at all. */
export const AI_SUGGESTION_MIN_CONFIDENCE = 0.7
/** Lower bound for the "pre-fill" path (one-tap confirm). */
export const AI_SUGGESTION_PREFILL_CONFIDENCE = 0.9

export function deriveAiSuggestionChip(input: AiSuggestionChipInput): AiSuggestionChipText {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? input.confidence : 0))
  const percent = Math.round(clamped * 100)
  const route: AiSuggestionRoute =
    clamped >= AI_SUGGESTION_PREFILL_CONFIDENCE
      ? 'pre-fill'
      : clamped >= AI_SUGGESTION_MIN_CONFIDENCE
        ? 'top-three'
        : 'no-suggestion'
  const head = input.lang === 'sw' ? 'Borjie inapendekeza' : 'Borjie suggests'
  let text = `${head} ${input.suggestionLabel} · ${percent}%`
  if (input.reason !== undefined && input.reason.length > 0) {
    text = `${text} · ${input.reason}`
  }
  return Object.freeze({ text, route, percent })
}
