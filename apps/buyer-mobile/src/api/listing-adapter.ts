import type { AssayResult, Listing, Mineral, Seller } from '@/types/listing'

/**
 * Pure marketplace-listing adapter. Kept in its own React-Native-free
 * module (no `./client` / SecureStore imports) so it is unit-testable under
 * the node/rollup vitest rig — the same split the rest of the buyer surface
 * uses (`trustChips.ts`, `derivations.ts`, `crossTenant.ts`). `marketplace.ts`
 * re-exports `mapListing` and applies it in the fetchers.
 */

/**
 * Raw `marketplace_listings` row as the api-gateway returns it (see
 * services/api-gateway/src/routes/mining/marketplace.hono.ts — the row is
 * spread verbatim, augmented with `sellerTenantId` + `sellerName`). Numeric
 * columns are string-encoded by postgres.js; the rich domain fields the
 * buyer surface renders (mineral, grade, quantity, origin, assay, chain of
 * custody) live inside the free-form `attributes` JSON — there is NO
 * first-class column for any of them. Every field is optional/unknown here
 * because the wire is untrusted; `mapListing` is the single point that
 * hardens it into the `Listing` shape the screens read.
 */
export interface RawListingRow {
  readonly id?: unknown
  readonly title?: unknown
  readonly category?: unknown
  readonly priceTzs?: unknown
  readonly priceUnit?: unknown
  readonly status?: unknown
  readonly visibility?: unknown
  readonly photos?: unknown
  readonly attributes?: unknown
  readonly createdAt?: unknown
  readonly sellerTenantId?: unknown
  readonly sellerName?: unknown
}

const MINERALS: readonly Mineral[] = [
  'gold_concentrate',
  'tanzanite_rough',
  'coltan',
  'copper_concentrate',
  'gemstone_mixed',
  'gold_dore',
  'tin_cassiterite',
  'silver_concentrate'
]

/**
 * Normalise a raw `attributes.mineral` value into the FE `Mineral` enum.
 * Accepts either the canonical enum value or the terse seed codes the
 * back-office writes (`Au`, `Au+Cu`, `Diamond+Tanzanite`, …). Unknown
 * strings fall back to `gold_concentrate` so `mineralGlyph[...]` never
 * indexes `undefined` (which would blank the card glyph). Never invents a
 * mineral the row did not carry — it only maps a present code.
 */
function normaliseMineral(raw: unknown): Mineral {
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase()
    const exact = MINERALS.find((m) => m === lower)
    if (exact) return exact
    // Terse seed codes → enum (first token wins for composite codes).
    const head = lower.split('+')[0]?.trim() ?? ''
    if (head === 'au' || head === 'gold') return 'gold_concentrate'
    if (head === 'cu' || head === 'copper') return 'copper_concentrate'
    if (head === 'ta' || head === 'coltan') return 'coltan'
    if (head === 'sn' || head === 'tin' || head === 'cassiterite') return 'tin_cassiterite'
    if (head === 'ag' || head === 'silver') return 'silver_concentrate'
    if (head === 'tanzanite' || head === 'tz') return 'tanzanite_rough'
    if (head === 'diamond' || head === 'gemstone' || head === 'gem') return 'gemstone_mixed'
  }
  return 'gold_concentrate'
}

/**
 * DB `marketplace_listings.status` (`active|paused|expired|sold|removed`)
 * → FE `Listing['status']` (`open|reserved|closed`). The buyer surface
 * only speaks three states: `active` is browsable ("open"); `paused`/
 * `expired` are temporarily off the market ("reserved"); `sold`/`removed`
 * are terminal ("closed"). An unrecognised status is treated as `closed`
 * so it never masquerades as biddable.
 */
function mapStatus(raw: unknown): Listing['status'] {
  switch (typeof raw === 'string' ? raw.toLowerCase() : '') {
    case 'active':
      return 'open'
    case 'paused':
    case 'expired':
      return 'reserved'
    case 'sold':
    case 'removed':
      return 'closed'
    default:
      return 'closed'
  }
}

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function attrStr(attrs: Record<string, unknown>, key: string): string {
  const v = attrs[key]
  return typeof v === 'string' ? v : ''
}

function attrPositiveNumber(attrs: Record<string, unknown>, ...keys: readonly string[]): number {
  for (const key of keys) {
    const raw = attrs[key]
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function assayArray(value: unknown): readonly AssayResult[] {
  if (!Array.isArray(value)) return []
  return value.reduce<AssayResult[]>((acc, entry) => {
    const rec = asRecord(entry)
    const element = typeof rec.element === 'string' ? rec.element : ''
    if (element.length === 0) return acc
    return [
      ...acc,
      {
        element,
        grade: typeof rec.grade === 'string' ? rec.grade : String(rec.grade ?? ''),
        method: typeof rec.method === 'string' ? rec.method : ''
      }
    ]
  }, [])
}

/**
 * The gateway serves NO seller-reputation columns (there is no `rating` /
 * `pmlNumber` / `verified` on `marketplace_listings`). We therefore build a
 * neutral `Seller` from the attribution the row DOES carry (`sellerName` /
 * `sellerTenantId`) and NEVER invent a rating: `rating` is `0`, which the
 * trust-chip derivation + detail screen already read as "no reputation
 * signal" and suppress. The rich fixture/chat `seller` (with a real rating)
 * still flows through when a caller supplies it.
 */
function deriveSeller(
  attrs: Record<string, unknown>,
  sellerTenantId: string,
  sellerName: string
): Seller {
  return {
    id: sellerTenantId,
    name: sellerName,
    pmlNumber: attrStr(attrs, 'pmlNumber'),
    rating: 0,
    verified: false
  }
}

/**
 * THE marketplace adapter. Maps ONE raw gateway `marketplace_listings` row
 * (numeric strings + rich fields buried in `attributes`) into the FE
 * `Listing` shape every buyer screen reads directly. This is the single
 * root-cause fix for the detail-screen crash (`chainOfCustody` /
 * `assayResults` / `seller` were `undefined`), the fabricated card ("TZS —"
 * + blank grade/quantity), the stale status pill, and the always-empty
 * home rails.
 *
 * Contract:
 *  - Every array field defaults to `[]` (never `undefined`) so `.map(...)`
 *    is always safe.
 *  - Price: `priceTzs` is the total parcel hint (`priceHintTzs`); the per-kg
 *    figure the UI shows is derived as total ÷ quantityKg when a positive
 *    quantity is present, else falls back to the total.
 *  - Status is mapped DB → FE enum (`active` → `open`).
 *  - Currency stays TZS-by-schema (columns are `*Tzs`); no display symbol
 *    is hardcoded here — `formatTzs` owns the currency-code render.
 *  - No reputation is fabricated (see `deriveSeller`).
 */
export function mapListing(raw: RawListingRow): Listing {
  const attrs = asRecord(raw.attributes)
  const sellerTenantId =
    typeof raw.sellerTenantId === 'string' ? raw.sellerTenantId : ''
  const sellerName = typeof raw.sellerName === 'string' ? raw.sellerName : ''
  const quantityKg = attrPositiveNumber(attrs, 'quantityKg', 'quantity_kg')
  const priceHintTzs = toNumber(raw.priceTzs)
  const priceTzsPerKg =
    quantityKg > 0 ? priceHintTzs / quantityKg : priceHintTzs
  const originSite = attrStr(attrs, 'originSite') || attrStr(attrs, 'origin')
  const originRegion = attrStr(attrs, 'region') || attrStr(attrs, 'originRegion')

  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    mineral: normaliseMineral(attrs.mineral),
    title: typeof raw.title === 'string' ? raw.title : '',
    grade: attrStr(attrs, 'grade'),
    quantityKg,
    originSite,
    originRegion,
    seller: deriveSeller(attrs, sellerTenantId, sellerName),
    priceTzsPerKg,
    priceHintTzs,
    photos: stringArray(raw.photos),
    assayPdfUrl: attrStr(attrs, 'assayPdfUrl'),
    assayResults: assayArray(attrs.assayResults),
    chainOfCustody: stringArray(attrs.chainOfCustody),
    listedAt:
      typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    status: mapStatus(raw.status),
    sellerTenantId: sellerTenantId.length > 0 ? sellerTenantId : undefined,
    sellerName: sellerName.length > 0 ? sellerName : null
  }
}
