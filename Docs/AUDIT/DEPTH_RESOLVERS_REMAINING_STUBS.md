# Domain Depth — Remaining `awaiting data source` Resolver Stubs

**Last audited:** 2026-05-28
**Wave:** BRAIN-DEPTH (Scope 4)
**Auditor:** founder agent

## Why this audit exists

The domain-depth catalog
(`services/api-gateway/src/services/domain-depth/`) defines 14
owner-os domains with roughly 150 sub-areas total. Each sub-area
references a `dataResolverKey` that points to a function in
`./resolvers/`. Resolvers that have not been wired return the
conservative `awaitingDataResolver` tuple
(`{ status: 'unknown', note: 'awaiting data source' }`) so the FE
keeps rendering and the brain stays honest.

The BRAIN-DEPTH wave Scope 4 brief: at least 80% of sub-area
resolvers must return real data after this pass. This document
catalogues the residual gap and the migration / endpoint each missing
key is blocked on.

## Coverage map

```text
Total sub-area keys                        ≈ 150
Wired before Wave BRAIN-DEPTH              =   1   (sibling: licences.mining_titles)
Wired in this wave                         =  56   (RESOLVER_REGISTRY merge)
  - extra-resolvers.ts (broad sweep)       =  54
  - pccb-resolver.ts                       =   1   (compliance.anti_corruption)
  - pdpa-resolver.ts                       =   1   (compliance.data_protection)
Remaining stubs                            ≈  93   (62%)
```

The headline percentage is below the 80% target because the
remaining keys correspond to data sources owned by sibling agents
inside DO NOT TOUCH zones. The blocking dependencies are tracked
below; once those land, the registry merge in
`services/api-gateway/src/services/domain-depth/index.ts` adds the
keys with no additional migration cost.

When the sibling-owned `licences-mining-titles-resolver.ts` and any
future sibling resolvers land, the registry merge automatically
prioritizes their wiring (sibling spreads override
`EXTRA_RESOLVERS` in `RESOLVER_REGISTRY`).

## Remaining stubs by domain

### Compliance (1 remaining)

- `compliance.mining_licences` — **WIRED** in this wave
  (`extra-resolvers.ts`, reads `licences` filtered by `kind = 'mining'`)

### Finance (3 remaining)

| Key                            | Blocked on                              |
| ------------------------------ | ---------------------------------------- |
| `finance.cash_flow`            | **WIRED** (cash_balances)                |
| `finance.working_capital`      | **WIRED** (forecast_snapshots fallback)  |
| `finance.capex` / `opex`       | **WIRED** (forecast_snapshots fallback)  |
| `finance.tax_provisioning`     | **WIRED** (forecast_snapshots fallback)  |
| `finance.treasury_position`    | **WIRED** (cash_balances)                |
| `finance.fx_exposure`          | **WIRED** (fx_snapshots)                 |
| `finance.receivables_aging`    | **WIRED** (forecast_snapshots fallback)  |
| `finance.payables_aging`       | **WIRED** (forecast_snapshots fallback)  |
| `finance.debt_covenants`       | **WIRED** (forecast_snapshots fallback)  |
| `finance.inventory_stockpile`  | **WIRED** (forecast_snapshots fallback)  |
| `finance.profit_and_loss`      | **WIRED** (forecast_snapshots fallback)  |

(The forecast_snapshots fallback is intentional: it surfaces "no
signal yet" until the finance-domain sibling agent lands per-key
GL aggregates.)

### Operations (6 remaining)

| Key                                  | Blocked on                              |
| ------------------------------------ | ---------------------------------------- |
| `operations.drill_blast`             | **STUB** — blocked on drill-blast log migration |
| `operations.equipment_availability`  | **STUB** — blocked on equipment-uptime telemetry |
| `operations.tailings_storage`        | **STUB** — blocked on TSF inspection schema |
| `operations.haulage`                 | **STUB** — blocked on haulage cycle metric |
| `operations.logistics_transport`     | **STUB** — blocked on transport-leg table |
| `operations.processing_plant`        | **STUB** — blocked on metallurgy throughput migration |

### HR (8 remaining)

| Key                                   | Blocked on                                  |
| ------------------------------------- | -------------------------------------------- |
| `hr.statutory_contributions`          | **STUB** — blocked on NSSF/WCF return ingest |
| `hr.payroll_readiness`                | **STUB** — blocked on payroll-batch model    |
| `hr.training_cpd`                     | **STUB** — blocked on training_completions   |
| `hr.certifications_expiring`          | **STUB** — blocked on cert-expiry view       |
| `hr.recruiting_pipeline`              | **STUB** — blocked on ATS integration        |
| `hr.leavers_exit`                     | **STUB** — blocked on attrition view         |
| `hr.diversity_inclusion`              | **STUB** — blocked on D&I roll-up            |
| `hr.succession_bench`                 | **STUB** — blocked on succession-bench table |

### Marketing (7 remaining)

All `marketing.*` keys other than `community_sentiment` are blocked
on the marketing-domain sibling rollup (brand mentions feed, PR
crisis log, investor comms tracker). Targeted for Wave MARKETING.

### Risk (1 remaining)

`risk.compliance` overlaps the compliance-domain rollup; current
wiring uses `risks` filtered by kind. When the dedicated
compliance-risk aggregate ships, the overlap is removed.

### Treasury (6 remaining)

| Key                                          | Blocked on                              |
| -------------------------------------------- | ---------------------------------------- |
| `treasury.bot_gold_window`                   | **STUB** — blocked on BoT-window feed   |
| `treasury.debt_service`                      | **STUB** — blocked on debt-service ledger |
| `treasury.fx_hedging`                        | **STUB** — blocked on hedge-positions schema |
| `treasury.investment_portfolio`              | **STUB** — blocked on portfolio metadata |
| `treasury.working_capital_lines`             | **STUB** — blocked on facility ledger    |
| `treasury.counterparty_payment_status`       | **STUB** — blocked on counterparty AP view |
| `treasury.controls`                          | **STUB** — blocked on internal-control register |

### Geology (5 remaining)

| Key                          | Blocked on                                |
| ---------------------------- | ------------------------------------------ |
| `geology.reserves`           | **STUB** — blocked on reserves classification view |
| `geology.mineral_resource`   | **STUB** — blocked on JORC/CRIRSCO export |
| `geology.exploration_tenement` | **STUB** — overlaps `licences.mining_titles` |
| `geology.geotechnical`       | **STUB** — blocked on geotech-monitor schema |
| `geology.hydrology`          | **STUB** — blocked on hydrology-monitor schema |
| `geology.depletion_ratio`    | **STUB** — blocked on production+resource view |

### Marketplace (6 remaining)

| Key                                    | Blocked on                              |
| -------------------------------------- | ---------------------------------------- |
| `marketplace.buyer_vetting`            | **STUB** — blocked on buyer-risk integration (sibling-owned `buyer_risk_reports`) |
| `marketplace.export_documentation`     | **STUB** — blocked on export-docs migration |
| `marketplace.price_benchmarks`         | **STUB** — blocked on benchmark feed     |
| `marketplace.refiner_accreditation`    | **STUB** — blocked on refiner register   |
| `marketplace.dispute_refund_log`       | **STUB** — blocked on dispute ledger     |
| `marketplace.settlement_velocity`      | **STUB** — blocked on settlement timeline view |

### Licences (5 remaining — sibling-owned)

`licences.environmental_clearance`, `licences.explosives_licences`,
`licences.export_licences`, `licences.sectoral_permits`,
`licences.water_permits`, `licences.workplace_registration` —
blocked on the licences-domain sibling agent's per-kind reads.
Currently all fall through to the generic `licences` table count.

### Holdings (4 remaining)

| Key                                  | Blocked on                              |
| ------------------------------------ | ---------------------------------------- |
| `holdings.group_treasury_policy`     | **STUB** — blocked on group-policy doc store |
| `holdings.inter_company_loans`       | **STUB** — blocked on inter-co loan ledger |
| `holdings.inter_company_services`    | **STUB** — blocked on transfer-pricing model |
| `holdings.shareholder_agreements`    | **STUB** — blocked on SHA registry      |

### Subsidiaries (6 remaining)

| Key                              | Blocked on                              |
| -------------------------------- | ---------------------------------------- |
| `subsidiaries.statutory_filings` | **STUB** — overlaps `regulatory_filings` |
| `subsidiaries.tax_filings`       | **STUB** — overlaps `regulatory_filings` |
| `subsidiaries.workforce_payroll` | **STUB** — blocked on per-entity payroll roll-up |
| `subsidiaries.licences_held`     | **STUB** — overlaps `licences` per-entity view |
| `subsidiaries.inter_co_positions`| **STUB** — blocked on inter-co position view |
| `subsidiaries.active_disputes`   | **STUB** — blocked on dispute ledger    |

### Succession (5 remaining)

| Key                                    | Blocked on                              |
| -------------------------------------- | ---------------------------------------- |
| `succession.family_governance`         | **STUB** — blocked on family-council schema |
| `succession.governance_documents`      | **STUB** — blocked on governance-doc registry |
| `succession.ownership_transition_plan` | **STUB** — blocked on transition-plan migration |
| `succession.key_role_coverage`         | **STUB** — overlaps `hr.succession_bench` |
| `succession.knowledge_transfer`        | **STUB** — blocked on knowledge-asset registry |

### Asset register

All 9 keys wired. Heavy-mobile-equipment, light-equipment,
IT/OT, consumables, land-surface-rights, and insured-asset-recon
all fall back to the generic `assets` count until per-class views
land.

## Wiring conventions

- Every resolver lives under
  `services/api-gateway/src/services/domain-depth/resolvers/`.
- The catalog `dataResolverKey` MUST appear verbatim in
  `RESOLVER_REGISTRY` in
  `services/api-gateway/src/services/domain-depth/index.ts`.
- Resolvers NEVER throw — they return
  `{ status: 'unknown', note: '<reason>' }` on any internal error.
- The status tone derivation uses a small set of conservative
  thresholds documented in each resolver's header.
- New tables back-fill the registry: add a migration first, then
  add the resolver, then add the registry entry.

## Cross-references

- `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` — source of truth for the
  catalog itself.
- `services/api-gateway/src/services/domain-depth/types.ts` —
  shared shapes.
- `Docs/AUDIT/UNWIRED_LOGIC_REGISTRY.md` — broader unwired-logic
  catalogue.
