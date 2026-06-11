/**
 * Owner-spawn → workforce tab projection — MOBILE side of the bridge.
 *
 * The server's `/api/v1/workforce/tab-config` response carries an
 * additive `projectedTabs[]` array: role-scoped projections of the
 * tenant's ACTIVE owner-spawned cockpit tabs (see
 * services/api-gateway/src/routes/workforce/tab-projection.ts).
 *
 * Mobile does NO dynamic UI generation. It renders KNOWN tab kinds only:
 * a projected kind maps onto an existing expo-router screen via
 * `PROJECTED_KIND_TO_SCREEN`; any unknown kind is SKIPPED (surfaced in
 * `skippedKinds` so the layout can log a DEV warning) — never a crash,
 * never a broken tab.
 *
 * Pure module (no react-native imports) so the logic is unit-testable
 * under the app's node vitest harness.
 */

import { z } from 'zod'

/** Server payload contract for one projected tab (additive field). */
const projectedWorkforceTabSchema = z.object({
  /** Owner-cockpit stable tab id. */
  id: z.string().min(1),
  /** Semantic kind — mapped onto a KNOWN screen below. */
  kind: z.string().min(1),
  /** Owner-given label, rendered verbatim on the tab. */
  label: z.string().min(1),
  /** Provenance marker. */
  origin: z.literal('owner-spawned')
})

export type ProjectedWorkforceTab = z.infer<typeof projectedWorkforceTabSchema>

/**
 * The KNOWN projected kinds and the expo-router screen each renders.
 * v1: marketplace projects onto the dedicated marketplace projection
 * screen. Growing this map is the ONLY mobile change a new projectable
 * kind needs.
 */
export const PROJECTED_KIND_TO_SCREEN: Readonly<Record<string, string>> = {
  marketplace: 'marketplace'
}

export interface ResolvedProjectedTab {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly screen: string
}

export interface ProjectionResolution {
  readonly resolved: ReadonlyArray<ResolvedProjectedTab>
  /** Unknown kinds encountered (deduped) — for a DEV-only warning. */
  readonly skippedKinds: ReadonlyArray<string>
}

const EMPTY_RESOLUTION: ProjectionResolution = Object.freeze({
  resolved: [],
  skippedKinds: []
})

/**
 * Validate the raw `projectedTabs` field from the server (or the
 * AsyncStorage cache). Entries that fail the schema are dropped —
 * a malformed projection can never crash the shell.
 */
export function parseProjectedTabs(
  raw: unknown
): ReadonlyArray<ProjectedWorkforceTab> {
  if (!Array.isArray(raw)) return []
  const out: ProjectedWorkforceTab[] = []
  for (const entry of raw) {
    const parsed = projectedWorkforceTabSchema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/**
 * Map validated projections onto known screens. One screen renders at
 * most one projection (first wins — server order is position-sorted);
 * unknown kinds are collected into `skippedKinds`.
 */
export function resolveProjectedTabs(
  tabs: ReadonlyArray<ProjectedWorkforceTab>
): ProjectionResolution {
  if (tabs.length === 0) return EMPTY_RESOLUTION
  const seenScreens = new Set<string>()
  const skipped = new Set<string>()
  const resolved: ResolvedProjectedTab[] = []
  for (const tab of tabs) {
    const screen = PROJECTED_KIND_TO_SCREEN[tab.kind]
    if (!screen) {
      skipped.add(tab.kind)
      continue
    }
    if (seenScreens.has(screen)) continue
    seenScreens.add(screen)
    resolved.push({ id: tab.id, kind: tab.kind, label: tab.label, screen })
  }
  return { resolved, skippedKinds: [...skipped] }
}
