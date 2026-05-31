# Project boundary

**This repository is BORJIE only.**

**Borjie is an AI-native mining estate operating system. Mr. Mwikila is
its brain layer.**

Mr. Mwikila is the brain layer within Borjie — an AI-native mining estate
operating system. He drafts, hedges, supervises, files. The owner signs
once. The product evolves independently, with its own roadmap, schema,
OpenAPI surface, mobile apps, juniors, regulator pack, marketing surface,
and CI pipeline.

Borjie covers Tanzanian (and pan-African) artisanal-to-mid-tier mining
end-to-end. **Mining domain only — never property / real estate.**

## Scope

Everything in this repo is Borjie. Mining domain. Tanzanian launch
vertical. Universal pluggable jurisdictional profiles (TZ → KE → NG →
universal) substrate. Mr. Mwikila as the front-door persona.

## Sibling project (informational only)

Borjie was hard-forked from a sibling property-management codebase
(BossNyumba). That codebase lives at
`/Cursor Projects/BOSSNYUMBA101/` and is reference-only (read). The
two products share fork-day origin but do not share an ongoing
identity, roadmap, persona, or parity goal — see
`Docs/BRAND/SEPARATION_AUDIT_2026_05_27.md` for the explicit
non-relationships list and the grep-results table.

Pongezi and LITFIN are unrelated sibling research projects. Different
repos, different products. Not in this repo.

## Do not

- Refer to property-domain entities (buildings, units, leases,
  occupancy, arrears, tenants-as-renters) in Borjie code, docs, or
  config. Property is not Borjie's vertical.
- Copy code or docs from the sibling project into Borjie unless it is
  generic AI-OS infrastructure that survives the property-domain trim
  (per the brand boundary note).
- Conflate Borjie's "tenant" (multi-tenant SaaS organisation = mining
  company group) with the property-domain "tenant" (renting
  occupant).
- Refer to Pongezi, LITFIN, or any other sibling project in Borjie
  code, docs, or config.
- Imply that Mr. Mwikila is the persona for any non-Borjie surface.
  Mr. Mwikila is Borjie-only.

All work in this repo applies to Borjie only.

## Deleted property-mgmt surfaces (post-hard-fork cleanup)

The fork left behind a number of BossNyumba route surfaces whose
backing repositories had been removed. Issue #165 deleted the
following route prefixes outright because Borjie has canonical
mining equivalents — callers must migrate to the Borjie surface:

- `/api/v1/hr/*` (6 routes — departments, teams, employees,
  assignments, performance) -> `/api/v1/workforce/*` +
  `workforce_certifications` / `workforce_invitations` /
  `workforce_role_tab_configs` schemas + the workforce-mobile app.
- `/api/v1/maintenance/*` (top-level, 5 routes — requests,
  dispatch-events, completion-proofs/verify) -> `/api/v1/mining/maintenance`
  (asset events on the `maintenance_events` table) +
  `/api/v1/mining/tasks` (covers every task type including equipment
  maintenance) + `/api/v1/mining/shift-reports`.
- `/api/v1/customer/{letters,sublease,move-out/disputes,marketplace/:unitId/negotiate(s)}`
  (4 routes) -> `/api/v1/mining/docs` (legal/contract drafting via
  `document_drafts`), `/api/v1/mining/marketplace` +
  `/api/v1/mining/bids` (mineral haggling via `bid_negotiations`),
  and the buyer-mobile app. Sublease + move-out disputes have no
  Borjie analogue (pure property-management concept).
- `/api/v1/owner/{work-orders,financial,invoices,payments,reports/export/financial,disbursements,messaging/conversations,documents/{signatures,/:id/sign}}`
  (14 routes) -> `/api/v1/mining/tasks`, `/api/v1/mining/sales`,
  `/api/v1/cooperatives/settlements`, `/api/v1/owner/messaging`
  (canonical owner_messaging schema), `/api/v1/owner/brief`,
  `/api/v1/mining/docs`, `/api/v1/mining/reports`. Mineral revenue
  flows through the payments-ledger (Stripe / M-Pesa) — there is no
  rental invoicing in Borjie.

See `Docs/AUDIT/POST_FORK_ROUTE_AUDIT.md` for the full per-route
decision matrix.
