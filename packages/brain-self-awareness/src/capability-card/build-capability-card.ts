// buildCapabilityCard — pure function over injected ports.
// No package-level singletons, no env reads, no I/O outside the passed deps.

import {
  CAP_BRAND,
  type CapabilityCard,
  type CapabilityCardDeps
} from './types.js'

const DEFAULT_RECENT_LIMIT = 5

/**
 * Builds a CapabilityCard by querying the injected ports in parallel.
 *
 * Failure mode: if any port throws, the error propagates — callers decide
 * whether to swallow or surface. We do NOT silently return a half-built card.
 */
export async function buildCapabilityCard(
  deps: CapabilityCardDeps
): Promise<CapabilityCard> {
  const clock = deps.now ?? (() => new Date())
  const limit = deps.recentDecisionsLimit ?? DEFAULT_RECENT_LIMIT

  const [enabled, disabled, ongoing, recent, suggestions, limits] =
    await Promise.all([
      deps.skills.listEnabled(),
      deps.skills.listDisabled(),
      deps.flows.listOngoing(),
      deps.decisions.listRecent({ limit }),
      deps.suggester.listSuggestions(),
      deps.calibration.getLimits()
    ])

  return {
    autonomyScope: deps.autonomyScope,
    cap: CAP_BRAND[deps.autonomyScope],
    canDo: enabled.map((s) => s.name),
    cantDo: disabled.map((s) => `${s.name} — ${s.reason}`),
    ongoingFlows: ongoing,
    recentDecisions: recent,
    suggestedNext: suggestions,
    calibratedLimits: limits,
    builtAt: clock().toISOString()
  }
}
