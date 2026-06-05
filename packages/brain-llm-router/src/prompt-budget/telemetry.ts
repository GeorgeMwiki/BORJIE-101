/**
 * telemetry — structured prompt-budget event + injected sink.
 *
 * The package has zero runtime deps; like every other module here, the budget
 * emits through an injected sink that defaults to a no-op. A composition root
 * (typically `services/api-gateway/src/index.ts`) calls `setPromptBudgetSink()`
 * once at boot with a Pino-backed sink. Until then events are dropped — never a
 * raw `console.*`.
 *
 * The `droppedLayers` field is the headline telemetry signal: it names the
 * lowest-priority layers the trim cascade had to shed to fit the budget, so an
 * operator can SLO prompt size instead of guessing.
 */

export interface PromptBudgetEvent {
  /** Coarse turn-shape label (classify / chat / longdoc …). */
  readonly intent: string;
  /** Estimated tokens of the kept layers after trimming. */
  readonly tokens: number;
  /** Hard ceiling that was enforced. */
  readonly maxTokens: number;
  /** Soft warning threshold. */
  readonly warnTokens: number;
  /** True when `tokens > warnTokens` (over soft budget). */
  readonly overWarn: boolean;
  /** True when the cascade had to drop ≥1 layer. */
  readonly trimmed: boolean;
  /** Names of dropped layers, lowest-priority first. */
  readonly droppedLayers: readonly string[];
  /** ISO timestamp. */
  readonly at: string;
}

export type PromptBudgetSink = (event: PromptBudgetEvent) => void;

const NOOP_SINK: PromptBudgetSink = () => {};

let injectedSink: PromptBudgetSink = NOOP_SINK;

/** Composition-root hook: install a real (Pino-backed) sink once at boot. */
export function setPromptBudgetSink(sink: PromptBudgetSink): void {
  injectedSink = sink;
}

/** Test / teardown helper: revert to the no-op sink. */
export function resetPromptBudgetSink(): void {
  injectedSink = NOOP_SINK;
}

/**
 * Emit a budget event through the injected sink. Wrapped in try/catch so a
 * misbehaving sink can never break the prompt hot path (this is telemetry).
 */
export function emitPromptBudgetEvent(event: PromptBudgetEvent): void {
  try {
    injectedSink(event);
  } catch {
    // Telemetry must never throw into the caller. Swallow + move on.
  }
}
