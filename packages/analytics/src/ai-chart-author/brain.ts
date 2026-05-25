/**
 * Brain port — the minimum surface the AI chart author needs.
 *
 * We do NOT depend on the full `@borjie/ai-copilot` type. Consumers
 * pass a thin adapter that wraps the multi-LLM synthesizer (or any
 * other LLM provider). This keeps the analytics package usable without
 * the heavy AI dep, and lets tests pass in deterministic fakes.
 */

export interface ChartAuthorBrain {
  /**
   * Submit a prompt expecting a JSON response. The author wraps the
   * prompt with structured-output rails on top of the brain's native
   * formatting — implementations may use Anthropic JSON mode, OpenAI
   * structured outputs, or a synthesizer Mixture-of-Agents path.
   */
  completeJson(prompt: string): Promise<{ readonly content: string }>;
}

/**
 * Adapter helper: wrap a multi-llm-synthesizer instance so it
 * implements `ChartAuthorBrain`. Used at composition root.
 *
 * NOTE: we intentionally type the synthesizer loosely so this file
 * compiles without a direct dep on @borjie/ai-copilot.
 */
export interface SynthesizerLike {
  synthesize(req: { readonly prompt: { readonly text: string }; readonly jsonMode?: boolean }): Promise<{
    readonly success: boolean;
    readonly data?: { readonly content: string };
    readonly error?: { readonly message: string };
  }>;
}

export function brainFromSynthesizer(syn: SynthesizerLike): ChartAuthorBrain {
  return {
    async completeJson(text) {
      const r = await syn.synthesize({ prompt: { text }, jsonMode: true });
      if (!r.success || !r.data) {
        throw new Error(`[analytics/ai-chart-author] synthesizer failed: ${r.error?.message ?? 'unknown'}`);
      }
      return { content: r.data.content };
    },
  };
}
