# Geospatial Parcel Management + Marketplace — SOTA 2026

**Audience:** BORJIE engineering + product.
**Scope:** A landlord walks the land, takes geolocation, subdivides it
into parcels on a map, annotates each (dimensions, status, evidence),
and publishes individual parcels OR the whole area to a marketplace
where other users browse the full history and transact.
**Bias:** Tanzania-first, Africa-realistic. Not generic SaaS.

---

## §1 — The landscape (14 players, what to copy)

Key fact of 2026: nobody has won **landlord-walks-the-land +
subdivide-and-sell**. Each leader owns one slice.

1. **Google Maps Platform — Photorealistic 3D Tiles + Map Tiles API.**
   2,500+ cities live, OGC 3D Tiles spec (glTF mesh + photogrammetry),
   same source as Google Earth. Renderable in Cesium / deck.gl.
   *Copy:* the "fly to your land from Earth view" moment for diaspora
   landlords in London / Dubai. We overlay parcel polygons on Google's
   tiles — we don't build mesh.
2. **Mapbox Studio + Mapbox MapGPT + MCP Server (2025).** Conversational
   maps via Mapbox Location Agent; agents call geocoding / isochrones /
   search as tools. *Copy:* "shamba plots within 30 min of Dar with
   road frontage > 20 m" as natural-language chat against our index.
3. **Esri ArcGIS Parcel Fabric.** Reference cadastral implementation —
   polygons defined by COGO lines from legal docs, full lineage. We
   borrow the data model, not the product (expensive, desktop-heavy).
4. **what3words.** 3m × 3m grid, Swahili words in TZ/KE. *Copy:* a w3w
   address per parcel centroid ("kifaru.barabara.shamba") travels in
   WhatsApp, SMS, voice, matatu posters. Highest-ROI anti-friction
   feature for TZ.
5. **Cadasta Foundation.** Open-source community land documentation in
   TZ / Indonesia / Bangladesh. Phone-first capture, evidence over
   title. *Copy:* the evidence-stack philosophy — in informal-land TZ
   you cannot demand a title; you accept witness letters and village
   stamps. (See §5.)
6. **The Land App (UK).** Pre-styled templates for subsidy / planning
   overlays. *Copy:* template-per-use-case (residential plot, shamba,
   mixed-use, beach plot) instead of free-form everything.
7. **Pacaso.** $72.5M Reg A+ 2025, 17,500 investors, 1/8–1/2 luxury
   second-home shares from $200K. *Copy:* the co-ownership scheduling
   app — once a 5-acre estate is split among 8 owners, they need a
   shared calendar + maintenance fund.
8. **Lofty AI.** $50 tokens on Algorand, daily rental dividends, 150+
   US rentals, $100M+ invested, built-in secondary market. *Copy:* the
   **secondary market** matters more than primary sale — that's where
   ongoing platform fees flow from.
9. **Landa (cautionary).** Collapsed May 2025, 25,000 investors locked
   out. *Lesson:* don't ship fractional v1 without a credible buyback
   liquidity mechanism. Full-parcel marketplace first; fractional later.
10. **Propy.** $4B+ blockchain-verified transactions 2021–2025 across
    38 countries; 24–48h settlement vs 30–60d traditional. 12 US states
    legally recognise blockchain property records as of 2026. *Copy:*
    the **dual-write pattern** — record on local registry AND on a
    hash-chained audit table. We already do this for AI audits.
11. **Hello Tractor.** 2.5M smallholder farmers, 6,500 equipment owners,
    18 African countries, PAYG with 5% down. *Copy:* PAYG financing on
    productive assets translates directly to parcels — "10% down, 36
    months to settle."
12. **Regrid (US/Canada).** Standardised Land Use Codes (LBCS) across 5
    dimensions: Function, Activity, Ownership, Structures, Site. Daily
    ownership + monthly zoning updates. *Copy:* the **5-dimension
    normalised parcel schema** is what makes cross-region marketplace
    search work.
13. **Overture Maps Foundation.** 2.6B buildings globally; TZ has
    ~14.9M building footprints from OSM + Microsoft. Free, open.
    *Copy:* pre-load building polygons under the parcel canvas so
    landlords can snap parcel edges to existing walls.
14. **e-Ardhi (Tanzania, launched March 2025).** Single authoritative
    digital land services portal (https://eardhi.lands.go.tz/), ILMIS
    back-end. Issues GROs / CROs. *Implication:* BORJIE does NOT
    compete with e-Ardhi — we integrate as the source of truth for
    title verification.

---

## §2 — Browser-based parcel-paint UX

### Drawing stacks (2026)

| Stack | Drawing | Mobile | Surveyor-grade |
|---|---|---|---|
| Mapbox GL + Mapbox GL Draw + Turf.js | Click-vertex + drag + snap | Yes | GeoJSON import + custom snap |
| MapLibre GL + mapbox-gl-draw (drop-in) | Same UX, open tiles | Yes | Same |
| Leaflet + Leaflet-Geoman | Draw / edit / cut / rotate / split / scale / snap | Touch-first | Best fit for low-spec Android |
| Google Maps JS + Drawing Library | Click-vertex, freehand | Native | KML / GeoJSON |
| OpenLayers Draw | Vertex + snap + ortho constraints | Heavier | Best snap quality |

### Mobile-first walk-the-land pattern (what we ship)

1. **Geolocation snap.** Request high-accuracy GPS on screen open. If
   HDOP > 10 m, prompt: "GPS is shaky — move into open sky or tap
   manually."
2. **Walk-the-perimeter mode.** Green "Drop pin" button at bottom; the
   landlord physically walks the boundary, each tap drops a vertex at
   current GPS. Auto-close when within 5 m of vertex 0.
3. **Tap-to-add mode.** Fallback. Long-press to drag vertices; pinch
   to zoom; double-tap to delete.
4. **Snap targets.** Existing parent edges, OSM road centerlines,
   imported beacon coordinates within 2 m.
5. **Surveyor import.** Accept GeoJSON, KML, DXF, and CSV
   `(beacon_id, easting, northing, datum)` from Trimble / Leica /
   Garmin. Convert Arc 1960 ↔ WGS84 before storing.
6. **Validate on submit.** Turf.js `booleanValid`, `booleanWithin
   (parent)`, `area()`. Refuse self-intersection and escaping children.

v0.app is excellent for the **attribute sidebar chrome** (forms,
drawers, dashboards) but has no geospatial primitives — wire to our
own canvas. Hello Tractor mobile is the UX north star: five fields
max per screen.

---

## §3 — Subdivision + parent-child polygons

### Hierarchy shape: closure table, not just adjacency

A parcel can be subdivided three times deep (`A` → `A.2` → `A.2.2` →
`A.2.2.b`). The marketplace history view will ask "what was the
polygon for `A.2`?" even after `A.2` no longer exists.

- **Adjacency list** (`parent_id`): simple, but every ancestor lookup
  is a recursive CTE. Hotspot at scale.
- **Closure table** (`ancestor_id`, `descendant_id`, `depth`, including
  depth-0 self-rows): O(1) lookups on index. Storage ~15 rows per
  5-deep leaf. Mature PostgreSQL patterns for moving subtrees.

**Decision:** Closure table + adjacency `parent_parcel_id`. Both. The
adjacency column makes UI breadcrumbs easy; the closure table answers
"show all descendants of this estate" in one query.

### ST_Subdivide ≠ legal subdivision

`ST_Subdivide` is a **performance** function — it chops huge polygons
for spatial-index efficiency (Crunchy Data benchmarks: 4× faster joins
on 1M-point datasets). Use it to index parent polygons, not to split
them legally.

For **legal** parent→children splits the landlord hand-draws child
polygons in the UI; we validate `ST_Union(children) ≈ parent` with a
small tolerance for survey error, persist children, mark parent
`status = subdivided` (NOT deleted — its polygon lives for history),
and write closure rows.

### Status state machine

```
draft → published → available
                  → reserved (7-day TTL lock)
                  → leased / sold
                  → disputed   (fail-closed — pauses all listings)
                  → subdivided (untransactable, history preserved)
                  → archived
```

`disputed` is non-negotiable for TZ. Boundary fights are common; the
platform must fail-closed or it becomes a fraud vector.

### Precedents

Mexico PROCEDE titled 27M hectares (1992–2006) — bulk titling works
when paired with community recognition. Rwanda RNRA has 10.4M parcels
nationally (top-down model, not ours). Kenya NLIMS is rolling out;
blockchain pilots stalled. Tanzania ILMIS / e-Ardhi (operational March
2025) is the canonical TZ source.

---

## §4 — Marketplace patterns

### The flow (List → Match → Contact → Transact → Fee)

1. **List.** From a parcel detail screen, "Publish to marketplace."
   Enforce: KYC complete, evidence trust ≥ 0.5, parcel not `disputed`.
   Seller sets price + currency (via `formatCurrency`), terms (sale /
   lease / rent), visibility (public / by-invite).
2. **Match.** Buyers browse via map cluster + faceted filters (price,
   area, road frontage, distance to road / water / town, use-code).
   Spatial filters use `ST_DWithin` on centroids; facets hit a 5-min
   materialised view.
3. **Contact.** Buyer taps "Express interest." In-app chat only —
   never expose seller phone in v1. Anti-fraud.
4. **Transact.** Refundable reservation deposit via
   `LedgerService.post()` flips parcel `available → reserved` (7-day
   TTL). Both parties upload title + ID; Piece K extracts entities;
   platform advocate verifies; escrow releases on title transfer.
5. **Fee.** Platform takes 2.5% transaction + 1% escrow, posted
   through LedgerService (NEVER direct ledger writes — CLAUDE.md hard
   rule).

### Search-by-polygon (the killer query)

"Parcels within 2 km of Bagamoyo Road with road frontage ≥ 50 m and
area 0.25–1 acre":

```sql
WITH road_buf AS (
  SELECT ST_Buffer(geom, 2000) AS g
  FROM osm_roads WHERE name ILIKE '%bagamoyo%'
)
SELECT p.* FROM parcels p
JOIN road_buf r ON ST_Intersects(p.geom, r.g)
WHERE p.status = 'available'
  AND p.area_sqm BETWEEN 1011 AND 4047
  AND p.road_frontage_m >= 50
ORDER BY ST_Distance(p.geom, (SELECT ST_Centroid(g) FROM road_buf))
LIMIT 50;
```

`road_frontage_m` is precomputed at publish time (length of
intersection between parcel boundary and nearest road polygon).
Never compute on the fly.

### Map clustering

`ST_ClusterKMeans` server-side at low zooms; raw polygons at high
zooms. pg_tileserv or Martin (Rust, MapLibre Foundation, 2026 default)
serves MVT vector tiles direct from PostGIS to MapLibre / Mapbox GL.

### Hidden seller fields + anti-fraud

- Seller phone / exact address / ID sit on `parcel_owner_private`
  table with RLS — only escrow officer reads.
- If a new polygon overlaps an existing `available` / `sold` parcel
  by > 10%, auto-flag `disputed` before publish.
- Title-deed hash mismatch against e-Ardhi PDF blocks the listing.

---

## §5 — Evidence and document attachment

TZ is not the US. A parcel may have any combination of:
GRO (Granted Right of Occupancy), CRO (Customary Right from village
council), survey diagram, sale agreement, witness letters,
geotagged photos. Evidence is a **stack**, not a single doc.

### Evidence type → trust weight

| Type | Weight | Source |
|---|---|---|
| GRO (TZ) | 1.00 | e-Ardhi PDF + verifier API |
| CRO (TZ village) | 0.70 | Scan + chairperson signature |
| Survey diagram | 0.80 | Licensed surveyor (Land Survey Act 1957) |
| Sale agreement | 0.50 | Notary signature |
| Lease agreement | 0.40 | Both parties |
| Witness letter | 0.20 | Village elders |
| Geotagged photo | 0.10 | Phone EXIF GPS |
| Beacon coords CSV | 0.60 | Surveyor instrument |

Listings need trust ≥ 0.5; > 100M TZS needs ≥ 0.7.

### AI extraction via Piece K

Existing `ingest → ocr → extract → route` gets a `parcel_evidence`
target. AI extracts plot number, block/village/district/region,
owner names, area, beacon coords, issue date, certificate number,
right-holder type. Human (escrow officer) confirms before trust
score increments.

### Blockchain title — dual-write, don't replace

Precedents: Propy ($4B+, dual-recorded county + chain), Sweden
Lantmäteriet (3–4 months → < 2 weeks in ChromaWay pilot), Ghana rural
pilots (70% verification time reduction).

For BORJIE v1 a private append-only hash-chained
`parcel_activity_log` (mirroring our AI audit chain pattern) delivers
the trust benefit without a public chain. IPFS is a backup pinning
layer for the title PDF, not the primary store. S3 + integrity hash
+ IPFS redundancy.

---

## §6 — PostGIS patterns (we are already on Postgres)

We have Drizzle + 183 migrations + pgvector. Add PostGIS.

1. **Geometry column.** `geom GEOMETRY(MULTIPOLYGON, 4326) NOT NULL`
   on `parcels`. SRID 4326 (WGS84) for storage; project to UTM 36S or
   37S for area calculation only.
2. **GIST index.** Required for `ST_Intersects` / `ST_DWithin`.
3. **ST_Subdivide for indexing parents** (not legal splits). 4×
   speedup on 1M-point intersect benchmarks.
4. **Server-side clustering** with `ST_ClusterKMeans` at low zooms.
5. **Martin** as the tile server (Rust, blazing fast); MapLibre /
   Mapbox GL renders. Cache MVT tiles in Cloudflare KV with 7-day TTL.
6. **Materialised view** `parcel_listings_mv` refreshes every 5 min
   with denormalised `road_frontage_m`, `distance_to_nearest_road`,
   `distance_to_water`, `distance_to_town`. Faceted search hits the MV.

---

## §7 — Tanzania context

Five hard truths a landlord-trust feature has to respect:

1. **All land is public, vested in the President.** No fee-simple.
   What we list is the *right of occupancy*. The UI must say so —
   buyers transact a *transfer of right*, not freehold.
2. **e-Ardhi is the only canonical GRO source.** Launched March 2025
   by President Samia. Title-verify integration is mandatory for
   high-trust listings. If e-Ardhi has no public API yet (likely
   through 2026), we use manual upload + verified-advocate workflow.
3. **Licensed surveyors are gatekeepers.** Land Survey Act 1957; the
   Tanzania Institution of Surveyors accredits, the Chief Government
   Surveyor holds the register. A surveyor's stamp on beacon CSV adds
   ≥ 0.6 trust. We onboard surveyors as platform partners and verify
   their licence number against TIS.
4. **Kawaida (customary) land is most of rural TZ.** No formal title;
   oral tradition + village chairperson stamps. Excluding CRO-only
   parcels excludes 70%+ of the market. CRO listings get a yellow
   badge; GRO listings green.
5. **Diaspora trust matters most.** TZ diaspora in UK / US / Gulf
   sends remittances to buy land back home and loses money to fraud
   constantly. Photoreal 3D + hash-chained evidence stack is the
   unlock for the highest-LTV segment.

EAC harmonisation is slow — a Kenyan buyer of a TZ plot still goes
through TIC (Tanzania Investment Centre) for a derivative right. We
surface that step, not hide it.

---

## §8 — Compliance + privacy

1. **KYC before listing.** NIDA ID (TZ) or passport; name match
   against title-holder. No listing without KYC + evidence ≥ 0.5.
2. **Public history is redacted by default.** Public sees: parcel ID,
   polygon, area, current status, status-change dates, *price if
   seller opts in*. Public never sees: seller name, contact, prior
   sale prices unless opted-in.
3. **Tanzania PDPA 2022** (operational 1 May 2023, registration
   deadline 30 April 2025). Closely aligned with GDPR; we register
   as data controller. Data-subject rights apply to seller profile,
   not to parcel records themselves (public-interest exception).
4. **Append-only audit log per parcel.** Every state change writes a
   hash-chained `parcel_activity_log` row. Never mutate. Same
   primitive as our AI audit chain.
5. **AML / FATF.** Flag cash transactions > 10M TZS for advocate
   review. Source-of-funds attestation required at reservation.

---

## §9 — Implementation recommendations for BORJIE

### Tables (Drizzle, RLS-FORCE on all tenant-scoped)

```sql
land_areas (
  id uuid pk, tenant_id uuid not null,
  name text, description text,
  centroid geometry(Point, 4326) not null,
  boundary geometry(MultiPolygon, 4326),
  total_area_sqm numeric,
  region, district, ward, village text,
  what3words text
);

parcels (
  id uuid pk, tenant_id uuid not null,
  land_area_id uuid references land_areas(id),
  parent_parcel_id uuid references parcels(id),    -- adjacency
  geom geometry(Polygon, 4326) not null,
  area_sqm, perimeter_m, road_frontage_m numeric,
  status parcel_status_enum not null default 'draft',
  what3words, color_tag text,
  evidence_trust_score numeric(3,2)
);

parcels_closure (                                  -- closure table
  ancestor_id uuid, descendant_id uuid, depth int,
  primary key (ancestor_id, descendant_id)
);

parcel_metadata (parcel_id, key text, value jsonb);

parcel_evidence_docs (
  id uuid pk, parcel_id uuid,
  evidence_type text, trust_weight numeric,
  storage_url, ipfs_cid text,
  extracted_entities jsonb,                        -- Piece K output
  verified_by uuid, verified_at timestamptz,
  hash bytea not null
);

parcel_marketplace_listings (
  id uuid pk, parcel_id uuid,
  listing_type text, price_minor int8,
  currency_code text, terms jsonb,
  visibility text default 'public', expires_at
);

parcel_activity_log (                              -- append-only chain
  id uuid pk, parcel_id uuid, event_type text,
  actor_id uuid, payload jsonb,
  prev_hash bytea, hash bytea not null,
  created_at timestamptz not null
);

parcel_color_tags (parcel_id, tag text, color_hex text);
```

GIST indexes on all geometry columns. `parcel_marketplace_listings`
joins to `parcel_listings_mv` for faceted search.

### Mobile (Flutter) flow

1. Splash → location permission.
2. Map opens at user GPS — MapLibre + Mapbox tiles.
3. Bottom sheet: Walk / Tap-draw / Surveyor-import.
4. Walk: green Drop-pin button at current GPS; shake-undo; auto-close
   within 5 m of vertex 0.
5. Tap: long-press to drag, double-tap to delete.
6. Turf validates → preview area sqm + acres → confirm.
7. Next: status, color tag, evidence upload (camera + file).
8. Optional: subdivide — draw children inside parent; validate union.

### Google Maps vs MapLibre

| Criterion | Google Maps | MapLibre + Martin |
|---|---|---|
| Tile cost at scale | $7 / 1000 dynamic loads | $0 (self-hosted) |
| 3D photoreal | Excellent | None (Cesium manual) |
| Drawing | Drawing Library | mapbox-gl-draw |
| Flutter | google_maps_flutter | maplibre_flutter |
| Offline | Limited | Full (PMTiles) |

**Decision:** MapLibre + Martin + PMTiles as primary stack — cost +
offline for rural surveyors. Google Photoreal 3D **only** on the
listing detail page for the "diaspora flies to their land" hero
moment. Premium garnish, not core canvas.

### Five concrete design decisions

1. **Closure table + adjacency** both. Adjacency for UI breadcrumbs;
   closure for marketplace history queries at scale.
2. **Evidence stack with weighted trust score**, not single title doc.
   TZ reality demands it.
3. **MapLibre + Martin** as primary; Google Photoreal 3D as premium
   garnish. Cost is the constraint at African data prices.
4. **Hash-chained `parcel_activity_log` mirroring our AI audit chain.**
   Same crypto primitive, ledger semantics already proven in codebase.
   Public blockchain is a future opt-in.
5. **`disputed` is a fail-closed state.** Pauses ALL listings on a
   parcel. TZ-specific. Without it, the platform becomes a fraud
   vector.

### Integration with existing pieces

- **Piece A (`core_entity`).** Add `LAND_PARCEL` entity type pointing
  to `parcels.id`. Extend, don't replace.
- **Piece K (document pipeline).** Add `parcel_evidence` route.
- **LedgerService.post()** for reservations, escrow holds, fees,
  payouts. NEVER direct ledger writes.
- **AI audit chain primitive** reused in `parcel_activity_log`.
- **`formatCurrency(amount, currencyCode)`** on every price render.
- **Kill-switch.** `parcels.disputed` honours fail-closed; never
  catch + swallow.

---

## Sources

- [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles-overview)
- [Mapbox MCP Server](https://www.mapbox.com/blog/introducing-the-mapbox-model-context-protocol-mcp-server)
- [Mapbox MapGPT and Location AI](https://www.mapbox.com/location-ai)
- [Mapbox GL Draw + Turf.js](https://docs.mapbox.com/mapbox-gl-js/example/mapbox-gl-draw/)
- [Esri ArcGIS Parcel Fabric](https://www.esri.com/en-us/arcgis/products/arcgis-parcel-fabric/overview)
- [Cadasta Foundation — open tech for land rights](https://cadasta.org/open-technology-for-land-rights-documentation/)
- [The Land App UK 2025](https://thelandapp.com/2025/02/25/how-digital-land-mapping-can-transform-the-uks-land-economy/)
- [Pacaso $72.5M Reg A+ 2025](https://www.superbcrew.com/luxury-real-estate-co-ownership-platform-pacaso-closes-72-5-million-raise/)
- [Lofty AI on Algorand](https://algorand.co/case-studies/lofty-transform-real-estate-industry)
- [Landa 2025 collapse review](https://www.lofty.ai/reviews/landa)
- [Propy 2024–2025 roadmap](https://propy.com/browse/propy-2024-2025-roadmap-the-year-of-the-onchain-real-estate-movement/)
- [what3words for land administration](https://egeomate.com/what3words-for-land-administration/)
- [Hello Tractor](https://hellotractor.com/about)
- [Tanzania e-Ardhi 2025](https://danvastproperty.com/news/tanzania-e-ardhi-system-2025-an-in-depth-guide-to-digital-land-services-nida-registration-and-online-applications)
- [Tanzania title deed verification](https://danvastproperty.com/news/how-to-verify-land-title-in-tanzania-legal-procedure-institutional-review-and-modern-verification-systems)
- [Tanzania Land Survey Act](https://tanzanialaws.com/statutes/principal-legislation/180-land-survey-act)
- [Tanzania PDPA 2022](https://www.afriwise.com/blog/the-personal-data-protection-act-no-11-of-2022-is-now-operational)
- [Sweden Lantmäteriet blockchain pilot](https://www.computerweekly.com/news/450421958/Sweden-trials-blockchain-for-land-registry-management)
- [Closure tables in PostgreSQL](https://medium.com/@yusoofash/handling-hierarchical-data-with-closure-tables-in-postgresql-167aac3a74f2)
- [Crunchy Data — ST_Subdivide performance](https://www.crunchydata.com/blog/postgis-performance-improve-bounding-boxes-with-decompose-and-subdivide)
- [Martin vector tile server](https://martin.maplibre.org/)
- [Leaflet-Geoman drawing](https://geoman.io/docs/leaflet/modes/draw-mode)
- [Regrid parcel API](https://regrid.com/api)
- [Overture Maps + buildings](https://docs.overturemaps.org/guides/buildings/)
- [mapbox_maps_flutter](https://pub.dev/packages/mapbox_maps_flutter)
