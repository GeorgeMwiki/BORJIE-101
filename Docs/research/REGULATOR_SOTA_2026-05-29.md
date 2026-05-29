# Regulator Integration — State of the Art (2026-05-29)

Audience: Borjie eng. Owner: regulator chain (`issue #194`).

This document distils the 2026 SOTA for the four regulator
surfaces Borjie integrates with (PCCB / NEMC / EITI / TMAA) and the
software architectural patterns Borjie should mirror. It exists so
the migrations + routes that follow can cite a source instead of
inventing terminology.

## 1. PCCB / PDPC — Tanzania Personal Data Protection Commission

- The Personal Data Protection Commission (PDPC) is the regulator
  established by the Personal Data Protection Act, 2022 + the 2023
  regulations.
- Unique to Tanzania: certain data-subject requests (rectification /
  block / delete) are mediated by the Commission rather than going
  directly to the controller. The Commission forwards the request
  to the data controller / processor for action.
- Complaints flow: data subject → PDPC → controller (us); PDPC
  retains observability throughout and a 30-day SLA before
  escalation under the Complaints Settlement Procedures Regulations,
  2023.
- Implication for Borjie: every PCCB-originated request needs an
  ack to the Commission within SLA, a recorded scope-of-disclosure
  approval (owner persona), and a redacted artifact returned via
  signed URL. Self-service from the regulator side is not yet
  mature — email + PDF still dominate.
- Source: PDPC portal `pdpc.go.tz`; Personal Data Protection Act
  2023; DLA Piper Tanzania chapter.

## 2. NEMC — National Environment Management Council

- NEMC operates the Projects Management System (PMS) at
  `eia.nemc.or.tz`. Two account types: developers + environmental
  experts. The system tracks EIA / EA submissions, inspections,
  and audit responses.
- Inspections are field-based; narratives + photos are still uploaded
  manually. The 2026 NEMC roadmap (per their public notice board)
  is to require structured JSON for inspection findings — Borjie
  should anticipate by storing inspection narratives as Markdown
  with structured front-matter.
- Implication: each inspection produces (a) a narrative (Markdown
  + photos), (b) a signed C2PA manifest covering the photos, and
  (c) a per-finding structured payload for downstream API
  submission.
- Source: nemc.or.tz; eia.nemc.or.tz; TIC NEMC procedures page.

## 3. EITI / TEITI — Extractive Industries Transparency

- TEITI's reporting cadence is annual (TEITI 14th Report covers
  FY 2021/22). The next Validation period begins 1 January 2026.
- New EITI Terms of Reference for reporting came into effect
  November 2024; standardised disclosures for revenues,
  beneficial ownership, contracts, and production volumes.
- Implication: Borjie aggregates monthly production +
  royalty payments and offers a one-click "generate TEITI
  contribution" export at year end, plus per-tenant contract
  + beneficial-ownership snapshots.
- Source: teiti.go.tz; eiti.org/countries/tanzania; EITI Board
  decision 2023-45.

## 4. TMAA — Tanzania Minerals Audit Agency

- TMAA conducts financial, environmental, and physical (quality
  / quantity) audits of mining licensees. Established 2009 (Govt
  Notice 362).
- TMAA does not (yet) expose a self-service portal; audit
  submissions are still email + courier of PDF + USB. The 2026
  modernisation plan referenced in the TMAA strategic plan
  hints at structured XML uploads via TUME YA MADINI gateway.
- Implication: Borjie should generate audit PDFs whose
  underlying data also serialises to a structured XML (TUME YA
  MADINI's reference schema) so the same dataset can be re-emitted
  when the API goes live.
- Source: tumemadini.go.tz; NCD listing; resourcegovernance.org
  TMAA case study.

## 5. SAP S/4HANA — Mining regulator integration patterns

- Mining S/4HANA deployments (SAVIC, SNP Group references) use
  SAP BTP (Business Technology Platform) as the integration spine.
  RPA bots automate the "submit-then-attach-evidence" pattern that
  most African mining regulators still require because they have no
  REST endpoints.
- 2026 architecture: regulator-facing flows are modelled as
  long-running BTP workflows with explicit state machines:
  `drafted → signed → submitted → acknowledged → closed`. Every
  state transition is auditable + replayable.
- Implication for Borjie: model `regulator_requests` and
  `licence_events` as explicit state machines + emit a cockpit
  event on every transition. The brain tools should never bypass
  the state machine — they merely advance it.
- Source: SAVIC mining brief; SNP Group blog; computerweekly.com
  "S/4HANA in 2026".

## 6. ESRI ArcGIS / Hexagon / Geosoft — regulator-grade GeoJSON

- ESRI's ArcGIS Pro `Features To JSON` tool is the de facto
  exchange format for parcel + licence boundaries; the Geosoft /
  Seequent Target plugin for ArcGIS Pro is the dominant mining-
  specific geo-layer pipeline.
- Hexagon's HxGN EAM integrates with ArcGIS Enterprise for
  asset-location reporting and is the reference for "regulator
  exports = GeoJSON FeatureCollection" with metadata stapled to
  each feature.
- Implication: Borjie's licence + inspection exports must emit
  GeoJSON FeatureCollection wrapped in a manifest envelope, with
  the EPSG:4326 polygon + provenance fields. Polygons already live
  in `licences.polygon` as PostGIS geography — we re-emit as
  GeoJSON.
- Source: github.com/Esri/arcgis-to-geojson-utils;
  doc.esri.com Features To JSON; seequent.com Target for
  ArcGIS Pro.

## 7. Cross-cutting decisions

| Decision | Rationale | Cite |
| --- | --- | --- |
| State-machine on `regulator_requests.status` | Mirrors SAP BTP workflow pattern | §5 |
| C2PA on every regulator-bound photo | NEMC inspections still accept PDF; provenance protects us in disputes | §2 |
| GeoJSON wrapper for licence exports | ESRI / Hexagon reference | §6 |
| 30-day default SLA on PDPC DSRs | Complaints Settlement Procedures Regulations 2023 | §1 |
| Bilingual sw/en narratives | CLAUDE.md hard rule; PDPC accepts either | §1 + repo rule |
| Owner-persona disclosure approval gate | PDPC requires controller sign-off; mirrors S/4HANA approval steps | §1 §5 |
| Annual + on-demand TEITI extracts | TEITI cadence is annual but next Validation begins 1 Jan 2026 | §3 |

## 8. Borjie target architecture (one-pager)

```
                regulator email / form
                          │
                          ▼
   ┌───────────────────────────────────┐
   │ admin-web — POST /regulator/...    │
   │ (parses + creates regulator_       │
   │  requests row, status=received)    │
   └─────────────┬──────────────────────┘
                 │ cockpit event
                 ▼
   ┌───────────────────────────────────┐
   │ owner-web — pulses on DSR        │
   │   approves disclosure scope        │
   │   signs licence renewal            │
   │   signs inspection narrative       │
   └─────────────┬──────────────────────┘
                 │ state machine advances
                 ▼
   ┌───────────────────────────────────┐
   │ admin-web — exports redacted PDF  │
   │   ledger entry → audit chain       │
   │   C2PA on photos                   │
   │   GeoJSON on geo exports           │
   └─────────────┬──────────────────────┘
                 │ signed URL
                 ▼
              regulator
```

Every state transition emits a `cockpit-event` so the owner cockpit
pulses live. Brain tools (`admin.regulator.create_request`,
`owner.regulator.approve_disclosure`, `owner.licence.start_renewal`,
`owner.licence.submit_renewal`, `manager.inspection.generate_narrative`,
`owner.inspection.sign`) advance the same state machines from chat.

## 9. Open questions (for future phases)

- TUME YA MADINI gateway: when their REST API ships, swap our
  PDF-and-email fallback for a structured POST. Today the
  generation pipeline is identical — only the egress changes.
- TEITI Validation 2026 — will TEITI publish a machine-readable
  contribution schema? If so, replace our manual JSON export with
  their canonical schema.
- NEMC PMS API: scrape vs. official. Until NEMC publishes
  credentials, we file by signed PDF + photographs.
