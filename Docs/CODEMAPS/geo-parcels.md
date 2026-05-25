# geo-parcels codemap (Piece N)

**Package:** `packages/geo-parcels`
**Migrations:** `0251..0260`
**Branch:** `claude/piece-n-geo-parcels`
**Last updated:** 2026-05-22

## What this piece does

A user walks to a piece of land, captures its outer boundary (via GPS
walk, manual map-draw, KML/GeoJSON import, or satellite trace), then
subdivides that boundary into parcels on a map. Each parcel can be
coloured, labelled, annotated with typed metadata, paired with evidence
documents (title deeds, leases, photos), and finally **published to a
cross-tenant marketplace** where buyers from any tenant can browse and
submit inquiries.

Every meaningful change appends a row to a per-parcel **hash-chained
activity log** — tampering with an old row breaks the chain.

## Data model

```
tenants
   └─ land_areas (0252)       ← outer boundary; jurisdiction; capture method
        └─ parcels (0253)     ← subdivisions; recursive via parent_parcel_id
             ├─ parcel_metadata (0254)        ← typed EAV (text/number/bool/date/enum/jsonb)
             ├─ parcel_evidence_docs (0255)   ← title deeds, leases, photos
             ├─ parcel_activity_log (0257)    ← append-only hash chain
             └─ parcel_marketplace_listings (0256)
                  └─ parcel_marketplace_inquiries (0259)   ← cross-tenant buyer pings

parcel_color_tags (0258)      ← per-tenant palette of meaningful colours
public_parcel_listings_v (0260) ← cross-tenant marketplace VIEW
```

### Polygon hierarchy

```
land_area "Kariakoo plot 27" — 5 acres                  (geography(POLYGON, 4326))
  ├─ parcel "27A" — 2 acres (parent_parcel_id NULL)
  │    └─ parcel "27A.1" — 0.5 acres (parent_parcel_id = 27A.id)
  │    └─ parcel "27A.2" — 1.5 acres
  └─ parcel "27B" — 3 acres
```

A `parcel` always references its root `land_area`, even when nested.
`parent_parcel_id` is NULL for first-level children of the land area.

### Status state machine

```
available  →  reserved  →  leased / sold
            ↘             ↘
              available (released) / disputed / unavailable
```

Every status transition appends a row to `parcel_activity_log` with
`event_kind = 'status_changed'`.

## Migration map

| Migration | Table / object | Why |
|-----------|----------------|-----|
| `0251_postgis_install.sql` | extension `postgis`, `postgis_topology` | Guarded install; Piece A may have already added postgis |
| `0252_land_areas.sql` | `land_areas` | Outer boundary captured by the user |
| `0253_parcels.sql` | `parcels` | Subdivisions, status, colour, label, zoning |
| `0254_parcel_metadata.sql` | `parcel_metadata` | Typed EAV — soil_type, water_access, etc. |
| `0255_parcel_evidence_docs.sql` | `parcel_evidence_docs` | Title deeds, leases, photos with trust_score |
| `0256_parcel_marketplace_listings.sql` | `parcel_marketplace_listings` | Sale / lease / shared_use / investment_partnership |
| `0257_parcel_activity_log.sql` | `parcel_activity_log` | Append-only hash chain |
| `0258_parcel_color_tags.sql` | `parcel_color_tags` | Tenant palette: tag → colour + meaning |
| `0259_parcel_marketplace_inquiries.sql` | `parcel_marketplace_inquiries` | Buyer pings; cross-tenant via inquirer_tenant_id |
| `0260_parcel_indexes.sql` | GiST + b-tree + `public_parcel_listings_v` | Spatial indexes + cross-tenant read view |

## Cross-tenant marketplace read path

`parcel_marketplace_listings` is RLS-isolated — a query against the
base table only returns the caller's tenant rows. The marketplace
breaks that isolation through ONE specific path:

```
                  ┌────────────────────────────────────────┐
 Browser session  │                                        │
 (tenant B user)  │  SELECT * FROM public_parcel_listings_v│
                  │  WHERE jurisdiction = 'TZ'             │
                  └─────────────────────┬──────────────────┘
                                        │
                                        ▼
                  ┌─────────────────────────────────────────┐
                  │ public_parcel_listings_v (0260)         │
                  │   pre-filters by listing_status = 'active' │
                  │   AND listing_visible_publicly = TRUE   │
                  │   SELECT projection (no contact info)   │
                  └─────────────────────┬───────────────────┘
                                        │
                                        ▼
                  ┌─────────────────────────────────────────┐
                  │ parcel_marketplace_listings (RLS base)  │
                  │   — RLS isolates by tenant_id on writes │
                  │   — view bypasses tenant scope for reads│
                  └─────────────────────────────────────────┘
```

**Writes** still go through the base table and are RLS-isolated.
**Reads from cross-tenant context** ALWAYS go through the view. There
is no INSTEAD-OF trigger; the view is read-only.

A buyer inquiry crosses the boundary in the OTHER direction:
- Tenant B's user submits an inquiry against `listing-1` (owned by
  tenant A) via a service-role endpoint that writes to
  `parcel_marketplace_inquiries` with
    `tenant_id = listing-1.tenant_id = 'tenant-A'`
    `inquirer_user_id = 'user-B'`
    `inquirer_tenant_id = 'tenant-B'`
- Tenant A's owner reads their inquiries through their normal
  RLS-isolated path; tenant B does NOT see the inquiry table.

## Activity log hash chain

Every row in `parcel_activity_log` carries:

- `prev_hash` — hash of the previous row for this parcel (NULL on first row)
- `hash` — `SHA-256(canonical-JSON({ parcel_id, event_kind, event_payload_jsonb, prev_hash, created_at }))`

`canonical-JSON` rules: keys sorted at every level, Date → ISO 8601,
undefined values dropped.

Verifying the chain (`verifyActivityChain(rows)`):
1. Walk in `created_at` ascending order
2. Each row's `prev_hash` MUST equal the previous row's `hash`
3. Recomputed hash MUST equal the stored hash
4. First mismatch → `{ ok: false, brokenAtIndex, reason }`

RLS on `parcel_activity_log` permits only SELECT and INSERT for the
`authenticated` role — UPDATE / DELETE are denied by default.
Service-role can override but each correction itself appends a new row
(no mutation in place).

## Package layout

```
packages/geo-parcels/
├── src/
│   ├── index.ts                     barrel
│   ├── types.ts                     Zod schemas + GeoParcelsError
│   ├── polygon-math.ts              centroid, area, within, overlap, bbox
│   ├── persistence-port.ts          adapter interface
│   ├── activity-log.ts              hash chain + appendActivity + verifyActivityChain
│   ├── land-area-capture.ts         captureLandArea(...) + ReverseGeocoder
│   ├── subdivide.ts                 subdivideParcel(...) + non-overlap + within validation
│   ├── metadata.ts                  setParcelMetadata(...) typed-EAV
│   ├── evidence.ts                  attachEvidence(...) title deed / lease / photo
│   ├── marketplace.ts               publishListing, searchMarketplace, fileInquiry
│   └── __tests__/                   in-memory port + 7 test files
└── ...
```

## API surface (high-level)

```typescript
// Capture
captureLandArea(port, args, reverseGeocoder?) -> LandArea

// Subdivide (validates ST_Within + non-overlap; logs activity)
subdivideParcel(port, args) -> Parcel[]

// Metadata
setParcelMetadata(port, args) -> ParcelMetadata
listParcelMetadata(port, parcelId, tenantId) -> ParcelMetadata[]

// Evidence
attachEvidence(port, args) -> ParcelEvidence
listEvidence(port, parcelId, tenantId) -> ParcelEvidence[]

// Marketplace
publishListing(port, args) -> MarketplaceListing
updateListingStatus(port, args) -> MarketplaceListing
searchMarketplace(port, filters) -> MarketplaceListing[]   // hits public_parcel_listings_v
fileInquiry(port, args) -> MarketplaceInquiry

// Activity log
appendActivity(port, args) -> ActivityLogRow
verifyActivityChain(rows) -> { ok: true } | { ok: false, brokenAtIndex, reason }
```

## Soft pointers

These columns reference tables that may not exist in every worktree:

| Column | Target | Wire-up migration |
|--------|--------|-------------------|
| `land_areas.core_entity_id` | `core_entity.id` (Piece A) | Future |
| `parcels.core_entity_id` | `core_entity.id` (Piece A) | Future |
| `parcel_evidence_docs.document_id` | `documents.id` (Piece K) | Future |
| `parcel_activity_log.actor_persona_id` | `personas.id` (Piece D) | Future |

When the target piece lands in `main`, append a new migration that
adds the FK constraint — never edit an existing migration.

## Constraints honored

- **PostGIS REQUIRED** — `geography(POLYGON, 4326)` for all polygons;
  GiST indexes for spatial filters
- **Multi-currency** — `currency_code` always paired with
  `asking_price_minor_units`; never hardcode TZS / KES / NGN
- **Hash-chained activity log** — `parcel_activity_log` append-only;
  RLS denies UPDATE / DELETE for `authenticated`
- **FORCE ROW LEVEL SECURITY** on every table; tenant_id GUC
  isolation via `public.current_app_tenant_id()`
- **Cross-tenant marketplace** ONLY through `public_parcel_listings_v`
- **Soft TEXT pointers** for tables that may not exist yet
- **80%+ test coverage** across polygon math, capture, subdivide,
  metadata, evidence, marketplace, RLS isolation, hash chain

## Testing strategy

PostGIS is NOT required for the package's unit tests — spatial maths
are implemented in pure JS in `polygon-math.ts`, and the in-memory
port uses those for `searchPublicListings`. PostGIS does the canonical
work in production; the JS maths are a sanity layer (instant UI
feedback) and a test substrate.

Test files:
- `polygon-math.test.ts` — centroid, area, within, overlap, bbox
- `activity-log.test.ts` — chain construction + verification (tamper detection)
- `land-area-capture.test.ts` — capture + reverse geocoder
- `subdivide.test.ts` — non-overlap, within-parent, activity events, nesting
- `metadata.test.ts` — typed-EAV validation for all 6 value_kinds
- `evidence.test.ts` — attach + activity log
- `marketplace.test.ts` — cross-tenant view, search filters, status updates, inquiries
- `rls-isolation.test.ts` — RLS-equivalent isolation across all tables
- `types.test.ts` — Zod schema sanity

## Deferred items

1. **FK wire-up** for soft pointers (`core_entity_id`, `document_id`,
   `actor_persona_id`) once Pieces A / K / D land.
2. **Drizzle adapter** in `services/api-gateway` that implements
   `GeoParcelsPort` against the live PostgreSQL + PostGIS.
3. **Application-tier ST_Within / ST_Intersects re-validation** on
   write paths in the api-gateway, as a defence-in-depth check
   alongside the JS maths.
4. **Cron expire job** that flips `listing_status` from `'active'` to
   `'expired'` when `expires_at < now()`.
5. **Currency normalisation** at marketplace search time via the
   `currency_preferences` chain — UI surfaces prices in the viewer's
   currency, not the lister's.
6. **Map UI** that uses `image_urls` and `boundary_polygon`. Lives in
   the customer + estate-manager apps; not in this package.
