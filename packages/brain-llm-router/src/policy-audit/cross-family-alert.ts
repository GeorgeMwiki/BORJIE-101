/**
 * Cross-family fallback alert helper.
 *
 * BORJIE already has the `onCrossFamilyFallback` hook on
 * `runFallback` (see `provider-fallback/fallback-router.ts`). What's
 * missing is the **default observability wiring** — every fallback
 * across provider families (e.g. anthropic → openai) should fire an
 * alert because the alternate provider has a different quality profile
 * and could break downstream contracts.
 *
 * Composition root wires this via:
 *
 *     bindCrossFamilyFallbackToLogger((event) => {
 *       pinoLogger.warn({ ...event }, '[fallback] cross-family')
 *       prometheusCounter.inc({
 *         from_family: event.fromFamily,
 *         to_family: event.toFamily,
 *       })
 *     })
 *
 * Then passes the returned hook into `runFallback({ ..., onCrossFamilyFallback })`.
 */

export interface CrossFamilyFallbackEvent {
  readonly fromProvider: string;
  readonly toProvider: string;
  readonly fromFamily: string;
  readonly toFamily: string;
  readonly taskKind: string;
  readonly reason: string;
  readonly timestampMs: number;
}

export type CrossFamilyFallbackEmitter = (
  event: CrossFamilyFallbackEvent,
) => void;

/**
 * Returns a function suitable for `runFallback`'s `onCrossFamilyFallback`
 * option. The returned function:
 *   - Detects family from provider name prefix.
 *   - Constructs the event with `Date.now()`.
 *   - Forwards to the supplied emitter.
 *   - Swallows emitter errors.
 */
export function bindCrossFamilyFallbackToLogger(
  emitter: CrossFamilyFallbackEmitter,
): (args: {
  readonly fromProvider: string;
  readonly toProvider: string;
  readonly taskKind: string;
  readonly reason?: string;
}) => void {
  return (args) => {
    const event: CrossFamilyFallbackEvent = {
      fromProvider: args.fromProvider,
      toProvider: args.toProvider,
      fromFamily: familyOf(args.fromProvider),
      toFamily: familyOf(args.toProvider),
      taskKind: args.taskKind,
      reason: args.reason ?? 'unknown',
      timestampMs: Date.now(),
    };
    try {
      emitter(event);
    } catch {
      // Hot path never crashes on observability.
    }
  };
}

/**
 * Coarse family-of-provider mapping. Used for alert grouping only —
 * not for routing decisions.
 */
function familyOf(providerName: string): string {
  const p = providerName.toLowerCase();
  if (p.includes('anthropic')) return 'anthropic';
  if (p.includes('openai')) return 'openai';
  if (p.includes('google') || p.includes('gemini')) return 'google';
  if (p.includes('deepseek')) return 'deepseek';
  if (p.includes('ollama') || p.includes('vllm')) return 'local';
  return 'unknown';
}
