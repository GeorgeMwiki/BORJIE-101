# Domain Signal Graph

**Status:** canonical
**Owner:** Borjie product + cross-domain intelligence
**Last updated:** 2026-05-28
**Audience:** correlation engine, causation tracer, comparison framework, insight emitter, brain prompts, MD intelligence service

## Why this graph exists

The Managing Director sees EVERY data point across the platform. A real MD does not answer a domain question in isolation; she instantly recalls which OTHER domains the asked-about state touches, walks the chain of cause and effect, compares the number against the right baselines, and surfaces the non-obvious insight the owner did not think to ask about.

This graph encodes the cross-domain edges that make that automatic. Nodes are sub-areas from the `DOMAIN_DEPTH_MANIFEST.md` catalog (14 domains, 18+12+11+12+8+14+9+9+9+8+7+8+7+9 = 145 sub-areas). Edges are typed causal or correlational links between sub-areas across (or within) those domains.

The graph is loaded by `services/api-gateway/src/services/md-intelligence/signal-graph.ts` and consumed by:

- `correlation-engine.ts` — given a domain question, returns the strongest cross-domain touches.
- `causation-tracer.ts` — given a symptom, walks UPSTREAM along the edges to surface ranked root causes.
- `comparison-framework.ts` — uses node-level metadata to decide which baselines apply (historical / peer cohort / external benchmark).
- `insight-emitter.ts` — uses edge metadata to detect non-obvious opportunities, risks, anomalies, trends, comparisons.

## Edge shape

Every edge has the following fields (mirrored in `signal-graph.ts`):

- `from` — source sub-area id (e.g. `compliance.tax`).
- `to` — target sub-area id (e.g. `compliance.banking_fx`).
- `kind` — `causal` | `correlational` | `composite`.
- `direction` — `forward` (when `from` shifts, `to` follows) | `bidirectional` (each affects the other).
- `strength` — 0..1 confidence that the edge fires in practice.
- `lagDays` — typical lag from `from` move to `to` move; 0 means same-day.
- `rationale` — plain-English why this edge exists (sw + en bilingual is encoded in the headline; the rationale here is single-language for graph builders).

## Edge inventory (target: ≥ 60)

The following edges are encoded in `signal-graph.ts`. Numbering is for cross-reference only; the runtime treats the graph as a flat list.

### Compliance → Compliance internal cascades

1. `compliance.environmental → compliance.mining_licences` — causal, 0.9, lag 0. A lapsed NEMC EIA blocks the Mining Commission from renewing the PML / ML on the next cycle (Mining Act 2010 s.43 + EMA 2004 s.81).
2. `compliance.tax → compliance.banking_fx` — causal, 0.85, lag 7d. A late TRA royalty filing freezes the BoT gold-window export channel until the receipt is presented.
3. `compliance.tax → compliance.trade_registration` — causal, 0.6, lag 30d. TRA defaulters list flows to BRELA's annual-return review and can trigger a director query.
4. `compliance.workplace_safety → compliance.workforce_certifications` — causal, 0.7, lag 14d. An OSHA incident reopens NACTVET equipment-operator certification checks.
5. `compliance.aml_kyc → compliance.banking_fx` — causal, 0.8, lag 0. A FIU red flag suspends BoT gold-window settlement instantly.
6. `compliance.customs → compliance.banking_fx` — composite, 0.75, lag 1d. Missing ASYCUDA documentation blocks USD repatriation against the same parcel.
7. `compliance.labour → compliance.workplace_safety` — correlational, 0.55, lag 30d. Unresolved labour grievances correlate with rising near-miss incidents.
8. `compliance.local_content → compliance.mining_licences` — causal, 0.7, lag 90d. Failing the 2018 Local Content Regulations quota triggers a Mining Commission compliance notice that can escalate to suspension.

### Compliance → Finance / Treasury / Risk

9. `compliance.tax → finance.tax_provisioning` — causal, 0.95, lag 0. The royalty draft IS the provisioning line; missing the draft means the P&L is wrong.
10. `compliance.tax → treasury.cash_position` — causal, 0.6, lag 15d. A penalty (5% + interest) on a late royalty drains cash by the cut-off + 15d.
11. `compliance.banking_fx → treasury.fx_hedging` — causal, 0.85, lag 0. Loss of gold-window access forces an unhedged USD position.
12. `compliance.banking_fx → finance.fx_exposure` — causal, 0.9, lag 0. Mirror of edge 11 on the finance side.
13. `compliance.environmental → risk.environmental_risk` — causal, 0.9, lag 0. An amber NEMC EIA pushes the environmental risk register from green.
14. `compliance.mining_licences → risk.regulatory_risk` — causal, 0.85, lag 0. Imminent licence expiry raises the regulator risk score.
15. `compliance.aml_kyc → risk.cyber_risk` — correlational, 0.4, lag 30d. AML failures correlate with KYC document leaks (cyber exposure).
16. `compliance.insurance → risk.insurance_gap` — causal, 0.95, lag 0. The same data point on two views.

### Operations → Finance / Compliance / Risk

17. `operations.production → finance.profit_loss` — causal, 0.95, lag 30d. Production tonnage feeds revenue line on the next monthly close.
18. `operations.production → compliance.tax` — causal, 0.9, lag 15d. Tonnage drives the royalty draft.
19. `operations.fuel → operations.production` — causal, 0.85, lag 5d. Fuel stock-out cancels haulage shifts within a week.
20. `operations.fuel → finance.opex` — causal, 0.95, lag 30d. Fuel is the largest opex line; price moves hit the P&L next close.
21. `operations.equipment_availability → operations.production` — causal, 0.85, lag 1d. A primary-plant breakdown trims throughput immediately.
22. `operations.shifts_crew → operations.production` — causal, 0.85, lag 1d. Absenteeism + understaffed shifts cut tonnage same-day.
23. `operations.incident_log → compliance.workplace_safety` — causal, 0.95, lag 0. Every recorded incident lands on the OSHA register.
24. `operations.incident_log → risk.operational_risk` — causal, 0.9, lag 7d. Repeat incidents at a site raise the operational-risk score within a week.
25. `operations.tailings_storage → compliance.environmental` — causal, 0.95, lag 0. A tailings dam approaching freeboard triggers the NEMC quarterly filing line.
26. `operations.tailings_storage → risk.environmental_risk` — causal, 0.95, lag 0. Same incident, risk register view.
27. `operations.maintenance → operations.equipment_availability` — causal, 0.8, lag 14d. Skipped planned maintenance correlates with breakdowns two weeks later.
28. `operations.haulage → operations.production` — causal, 0.7, lag 0. A queue at the crusher caps the daily mill feed.

### HR → Operations / Compliance / Finance / Risk

29. `hr.shifts_attendance → operations.shifts_crew` — causal, 0.9, lag 0. The same headcount; biometric data flows.
30. `hr.shifts_attendance → operations.production` — causal, 0.8, lag 1d. Absenteeism trims shift output.
31. `hr.certifications_expiring → compliance.workforce_certifications` — causal, 0.95, lag 0. Mirror sub-area.
32. `hr.statutory_contributions → compliance.labour` — causal, 0.95, lag 0. NSSF / WCF default IS a labour breach.
33. `hr.statutory_contributions → finance.opex` — causal, 0.95, lag 30d. Statutory hits payroll opex next close.
34. `hr.payroll_readiness → treasury.cash_position` — causal, 0.85, lag 1d. Payroll day is the largest single cash outflow.
35. `hr.safety_incidents → operations.incident_log` — causal, 0.9, lag 0. Mirror sub-area, different angle.
36. `hr.open_grievances → risk.human_capital_risk` — causal, 0.7, lag 14d. Unresolved grievances raise the union-action probability.
37. `hr.leavers_exit → operations.production` — causal, 0.5, lag 30d. Voluntary attrition (esp. supervisors) trims output over a month.
38. `hr.leavers_exit → operations.shifts_crew` — causal, 0.7, lag 14d. Same lever, faster signal.

### Geology → Operations / Finance / Risk / Marketplace

39. `geology.drill_programme → geology.mineral_resource` — causal, 0.85, lag 90d. Drilling extends the resource statement on the next annual update.
40. `geology.assay_backlog → operations.production` — causal, 0.6, lag 30d. Pending assays delay grade-control decisions.
41. `geology.grade_control → operations.production` — causal, 0.8, lag 0. Real grade vs plan changes the daily mill feed.
42. `geology.grade_control → compliance.tax` — causal, 0.7, lag 15d. Mine-call factor shifts royalty per parcel.
43. `geology.geotechnical → risk.environmental_risk` — causal, 0.85, lag 30d. Pit-slope instability raises tailings + environmental risk.
44. `geology.hydrology → operations.tailings_storage` — causal, 0.8, lag 14d. Rising water table raises pond level.
45. `geology.resource_depletion → risk.geological_risk` — causal, 0.95, lag 365d. Extraction > additions on the next annual = depleting reserve.
46. `geology.grade_control → marketplace.price_benchmarks` — correlational, 0.5, lag 7d. Grade-up parcels list at LBMA fix premium.

### Treasury → Finance / Compliance / Marketplace / Risk

47. `treasury.cash_position → finance.cash_flow` — causal, 0.95, lag 0. Same number on two views.
48. `treasury.fx_hedging → finance.fx_exposure` — causal, 0.95, lag 0. Mirror.
49. `treasury.bot_gold_window → marketplace.export_documentation` — causal, 0.85, lag 0. No window approval = no export shipment.
50. `treasury.bot_gold_window → compliance.banking_fx` — bidirectional, 0.9, lag 0. Mutual entanglement.
51. `treasury.debt_service → risk.financial_risk` — causal, 0.85, lag 30d. A missed coupon raises counterparty credit risk.
52. `treasury.working_capital_lines → finance.working_capital` — causal, 0.9, lag 0. Mirror.

### Marketplace → Compliance / Finance / Treasury / Risk

53. `marketplace.active_listings → finance.profit_loss` — causal, 0.7, lag 14d. List-to-cash 14d means revenue lands on the next close.
54. `marketplace.bids_received → marketplace.settlement_velocity` — correlational, 0.6, lag 7d. Strong bid stack shortens list-to-cash.
55. `marketplace.buyer_vetting → compliance.aml_kyc` — causal, 0.95, lag 0. Mirror sub-area.
56. `marketplace.chain_of_custody → compliance.customs` — causal, 0.95, lag 0. ASYCUDA needs the chain hash.
57. `marketplace.export_documentation → compliance.customs` — causal, 0.95, lag 0. Same data on two views.
58. `marketplace.price_benchmarks → finance.profit_loss` — causal, 0.85, lag 1d. LBMA fix moves the revenue figure on the next parcel.
59. `marketplace.price_benchmarks → treasury.fx_hedging` — causal, 0.85, lag 1d. LBMA fix drives the hedge.
60. `marketplace.dispute_refund_log → risk.counterparty_risk` — causal, 0.7, lag 30d. Dispute rate up = counterparty credit risk up.

### Risk → enterprise feedback loops

61. `risk.commodity_price → finance.profit_loss` — causal, 0.95, lag 30d. Gold/gem price swing hits revenue line.
62. `risk.currency_risk → treasury.fx_hedging` — bidirectional, 0.9, lag 0. The hedge IS the response to currency risk.
63. `risk.counterparty_risk → marketplace.buyer_vetting` — causal, 0.7, lag 30d. Buyer downgrade triggers a vetting reopen.
64. `risk.cyber_risk → compliance.data_protection` — causal, 0.8, lag 0. A breach kicks the 72-hour PDPA notification clock.
65. `risk.geopolitical → compliance.aml_kyc` — correlational, 0.6, lag 14d. Regional sanctions surge raises KYC flags.

### Marketing → Reputation / Risk / Marketplace

66. `marketing.community_sentiment → risk.reputational_risk` — causal, 0.8, lag 7d. Community grievance volume up = reputational risk up.
67. `marketing.community_sentiment → compliance.local_content` — correlational, 0.6, lag 30d. CDA performance correlates with community sentiment.
68. `marketing.counterparty_perception → marketplace.bids_received` — correlational, 0.5, lag 30d. Buyer NPS correlates with bid intensity.
69. `marketing.pr_crisis_log → risk.reputational_risk` — causal, 0.9, lag 0. Mirror with intensity.
70. `marketing.investor_communications → treasury.bank_relationships` — correlational, 0.5, lag 30d. Strong board pack correlates with covenant headroom.

### Holdings / Subsidiaries / Succession — corporate edges

71. `holdings.beneficial_ownership → compliance.trade_registration` — causal, 0.9, lag 0. BRELA wants the UBO filing current.
72. `holdings.inter_company_loans → compliance.tax` — causal, 0.7, lag 30d. Transfer-pricing documentation flows into TRA filing.
73. `subsidiaries.statutory_filings → compliance.trade_registration` — causal, 0.9, lag 0. Mirror.
74. `subsidiaries.tax_filings → compliance.tax` — causal, 0.95, lag 0. Mirror by entity.
75. `subsidiaries.active_disputes → risk.regulatory_risk` — causal, 0.7, lag 30d. Open litigation raises the regulator score.
76. `succession.key_role_coverage → risk.human_capital_risk` — causal, 0.85, lag 90d. Empty bench = key-person risk amber.
77. `succession.ownership_transition → holdings.beneficial_ownership` — causal, 0.9, lag 0. A share transfer requires a UBO filing.
78. `succession.estate_planning → holdings.group_structure` — causal, 0.6, lag 180d. Estate event triggers a group restructure.

### Asset register — fixed asset edges

79. `asset_register.fixed_assets → finance.capex` — causal, 0.95, lag 0. Same number on two views.
80. `asset_register.heavy_mobile_equipment → operations.equipment_availability` — bidirectional, 0.85, lag 0. The same fleet on two views.
81. `asset_register.ore_stockpile → finance.working_capital` — causal, 0.9, lag 0. Stockpile valuation IS working capital.
82. `asset_register.consumables_stock → operations.fuel` — causal, 0.9, lag 7d. Fuel inventory on the asset side; opex on the ops side.
83. `asset_register.insured_asset_reconciliation → compliance.insurance` — causal, 0.95, lag 0. Reconciliation gap = policy gap.
84. `asset_register.bullion_dore_inventory → marketplace.export_documentation` — causal, 0.85, lag 0. Stock waiting on a TRA export certificate.

### Long-lag environmental + climate edges

85. `risk.environmental_risk → operations.production` — causal, 0.6, lag 90d. A flood / drought trims a quarter of production.
86. `geology.hydrology → risk.environmental_risk` — causal, 0.85, lag 30d. Mirror at quarterly cadence.
87. `compliance.environmental → marketing.community_sentiment` — correlational, 0.5, lag 60d. A clean EIA refresh lifts village sentiment.

### Composite edges (chain expansions)

The graph also encodes a small number of well-known composite chains that the causation tracer collapses into a single rendering:

88. `hr.leavers_exit → operations.shifts_crew → operations.production` — composite, effective strength 0.7 * 0.85 = 0.6, lag 14d + 1d. Supervisor attrition cascades into shift fill cascades into output.
89. `compliance.tax → compliance.banking_fx → marketplace.export_documentation` — composite, effective strength 0.85 * 0.85 = 0.72, lag 7d + 0d. Late royalty freezes the gold-window which blocks the export.
90. `risk.commodity_price → marketplace.price_benchmarks → finance.profit_loss` — composite, 0.95 * 0.85 = 0.81, lag 1d + 30d. Spot move on the day → next close.

## Rules of the graph

- Every edge has BOTH ends present in `DOMAIN_DEPTH_MANIFEST.md`. The `signal-graph.test.ts` test fails CI if any node is missing.
- Strength `> 0.7` is a CAUSAL claim and is recommended for use in `trace_causes`. Strength `0.4..0.7` is CORRELATIONAL — surfaced in `correlation_for_question` but not in the root-cause walk.
- Lag is an honest typical, not a guarantee. The tracer uses lag to filter symptom windows (e.g. a 30-day-lag edge cannot explain a same-day spike).
- The graph is frozen at module load. Updates require a new edge + a doc PR. No runtime mutation.

## When to grow the graph

Add a new edge ONLY when:

- Both nodes already exist in the manifest catalog.
- The rationale references a real Tanzanian regulator, law, or operational pattern.
- The strength is calibrated against either internal telemetry or a published industry baseline (cite in the rationale).
- The lag is observed, not guessed.

Removing edges requires a doc PR plus a regression test that the affected `trace_causes` example no longer fires.

## Acceptance

90 edges encoded across the 14 owner-os domains. All edges have a rationale. All ends present in the depth manifest. Test `signal-graph.test.ts` asserts edge count >= 60 and 100% node referential integrity.
