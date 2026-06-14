/**
 * Owner-spawn → BUYER tab projection — MOBILE side of the bridge (KI-007).
 *
 * The server's GET /api/v1/buyer/tabs returns role/membership-scoped
 * projections of seller orgs' ACTIVE owner-spawned cockpit tabs that carry
 * an explicit `buyerProjection` opt-in (see
 * services/api-gateway/src/routes/buyer/tab-projection.hono.ts). Each row is
 * per-org: it carries the seller org/tenant it came from.
 *
 * Mobile does NO dynamic UI generation. It renders KNOWN projected kinds
 * only: a projected kind maps onto an existing expo-router screen via
 * `BUYER_PROJECTED_KIND_TO_SCREEN`; any unknown kind is SKIPPED (surfaced in
 * `skippedKinds` for a DEV warning) — never a crash, never a broken tab.
 *
 * Pure module (no react-native imports) so the logic is unit-testable under
 * the app's node vitest harness.
 */

import { z } from 'zod'

/** Server payload contract for one projected buyer tab. */
const projectedBuyerTabSchema = z.object({
  /** Owner-cockpit stable tab id. */
  id: z.string().min(1),
  /** Semantic kind — mapped onto a KNOWN screen below. */
  kind: z.string().min(1),
  /** Owner-given label, rendered verbatim on the tab. */
  label: z.string().min(1),
  /** The seller org this projection belongs to — per-org overlay scope. */
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  tenantName: z.string().nullable(),
  origin: z.literal('owner-spawned')
})

export type ProjectedBuyerTab = z.infer<typeof projectedBuyerTabSchema>

/**
 * KNOWN projected kinds → expo-router screen name inside `(tabs)/`.
 * `inquiry_respond` (the buyer leg of the golden inquiry flow) renders the
 * inquiries screen; `marketplace` aliases the marketplace tab. Growing this
 * map is the ONLY mobile change a new projectable kind needs.
 */
export const BUYER_PROJECTED_KIND_TO_SCREEN: Readonly<Record<string, string>> = {
  inquiry_respond: 'inquiries',
  marketplace: 'marketplace'
}

export interface ResolvedProjectedBuyerTab {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly screen: string
}

export interface BuyerProjectionResolution {
  readonly resolved: ReadonlyArray<ResolvedProjectedBuyerTab>
  /** Unknown kinds encountered (deduped) — for a DEV-only warning. */
  readonly skippedKinds: ReadonlyArray<string>
}

const EMPTY_RESOLUTION: BuyerProjectionResolution = Object.freeze({
  resolved: [],
  skippedKinds: []
})

/**
 * Validate the raw projection array from the server. Entries that fail the
 * schema are dropped — a malformed projection can never crash the shell.
 */
export function parseProjectedBuyerTabs(
  raw: unknown
): ReadonlyArray<ProjectedBuyerTab> {
  if (!Array.isArray(raw)) return []
  const out: ProjectedBuyerTab[] = []
  for (const entry of raw) {
    const parsed = projectedBuyerTabSchema.safeParse(entry)
    if (parsed.success) out.push(parsed.data)
  }
  return out
}

/**
 * Map validated projections onto known screens. One screen renders at most
 * one projection (first wins — server order is position-sorted); unknown
 * kinds are collected into `skippedKinds`.
 */
export function resolveProjectedBuyerTabs(
  tabs: ReadonlyArray<ProjectedBuyerTab>
): BuyerProjectionResolution {
  if (tabs.length === 0) return EMPTY_RESOLUTION
  const seenScreens = new Set<string>()
  const skipped = new Set<string>()
  const resolved: ResolvedProjectedBuyerTab[] = []
  for (const tab of tabs) {
    const screen = BUYER_PROJECTED_KIND_TO_SCREEN[tab.kind]
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
