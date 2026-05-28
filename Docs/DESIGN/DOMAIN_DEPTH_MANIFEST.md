# Domain Depth Manifest

**Status:** canonical
**Owner:** Borjie product + design
**Last updated:** 2026-05-28
**Audience:** brain prompts, panel surfaces, sub-area resolvers, every tool that touches an owner-os domain

The Borjie home tab is the Managing Director's cockpit. A Managing
Director owns the whole picture of every domain, not the single
most-obvious headline. "Compliance" is licences + tax + environmental
+ banking + trade + labour + workplace safety + anti-corruption +
data protection + AML/sanctions + standards + customs + insurance +
local content + human rights + telecoms. The same depth discipline
applies to finance, operations, HR, marketing, risk, treasury,
geology, marketplace, every domain.

This document is the ground truth for the depth catalog at
`services/api-gateway/src/services/domain-depth/index.ts`. Any change
here MUST be mirrored in the catalog and vice versa. The audit-trail
test asserts every entry in the catalog appears in this document.

Each sub-area MUST track:
- `id` — stable snake_case key
- `label` — bilingual sw/en
- `regulator` — Tanzanian authority (where applicable)
- `cadence` — annual / quarterly / monthly / event-driven
- `riskIfMissed` — penalty / fine / loss exposure in plain language
- `dataResolverKey` — function that resolves current status

Sub-areas without a real data source resolve to
`{ status: 'unknown', note: 'awaiting data source' }` so the FE
renders an "Awaiting data" pill instead of crashing or hiding the
row.

---

## 1. Compliance (full scope, never just licences)

The MD's compliance picture spans 18 sub-areas, all tenant-scoped, all
audit-chained. Mining licences are ONE of eighteen, not the whole
picture.

1. **Mining licences** — Mining Commission of Tanzania: PML, ML, SML renewal cycles, day-precise calendar, surface-rent payments, beneficial-ownership disclosure under the Mining Act 2010 as amended. *cadence: annual (PML), 5-yearly (ML), event-driven (SML).*
2. **Tax** — Tanzania Revenue Authority (TRA): royalty (commodity-correct rate per Mining Act 2010), corporate income tax (Income Tax Act 2004), PAYE, VAT (VAT Act 2014), withholding tax, capital gains, mineral export levy (Finance Act updates). *cadence: monthly (royalty, VAT, PAYE), annual (CIT).*
3. **Environmental** — National Environment Management Council (NEMC): EIA decision letters under the Environmental Management Act 2004, EMP / ESIA refresh, air-quality, water-quality, noise, waste-handling, tailings dams, reclamation bonds. *cadence: 4-yearly EIA refresh, quarterly monitoring.*
4. **Banking / FX** — Bank of Tanzania (BoT): gold-window export licence, USD repatriation under the Foreign Exchange Act 1992, FX hedging documentation, AML/CFT reporting under the Anti-Money Laundering Act 2006. *cadence: monthly reporting, annual licence.*
5. **Trade registration** — Business Registrations and Licensing Agency (BRELA): business-name renewal, annual returns, beneficial ownership, board resolutions under the Companies Act 2002. *cadence: annual.*
6. **Labour** — Labour Relations Act 2004 + Employment and Labour Relations Act 2004: minimum wage, leave entitlements, severance; National Social Security Fund (NSSF) contributions, Workers Compensation Fund (WCF) contributions, claims; collective bargaining where applicable. *cadence: monthly contributions.*
7. **Workplace safety** — Occupational Safety and Health Authority (OSHA): workplace registration under the OSHA Act 2003, health surveillance, accident reporting, mining-specific hazard registers, pit-safety audits. *cadence: annual registration, event-driven reporting.*
8. **Workforce certifications** — Institute of Chartered Accountants (ICA) for assay; National Council for Technical and Vocational Education and Training (NACTVET) for equipment-operator certificates, blast safety, first aid, working-at-heights. *cadence: annual refresh.*
9. **Anti-corruption** — Prevention and Combating of Corruption Bureau (PCCB): gifts and hospitality registers, declarations, lobbying disclosures under the PCCA Act 2007. *cadence: annual declaration, event-driven gifts log.*
10. **Data protection** — Personal Data Protection Act 2022 (PDPA), administered by the Personal Data Protection Commission: data-subject rights, breach notification within 72 hours, DPIA for any cross-border data flow, registration of controllers and processors. *cadence: event-driven plus annual review.*
11. **AML / sanctions / KYC** — Financial Intelligence Unit (FIU) under BoT: counterparty screening against OFAC, EU, UK and UN lists, suspicious transaction reports, FATF travel-rule compliance, beneficial-ownership verification. *cadence: per-transaction screening.*
12. **Trade standards** — Tanzania Bureau of Standards (TBS) + Fair Competition Commission (FCC): product standards, fair trading, weights and measures, bullion grading. *cadence: annual certification.*
13. **Customs** — TRA Customs: export permits, transit bonds, dore-bar provenance documentation, ASYCUDA filings, mineral export certificate. *cadence: per-shipment.*
14. **Quality / assay** — SGS Tanzania, Bureau Veritas, Alex Stewart, ICA: grading certifications, parcel sealing chain-of-custody. *cadence: per-parcel.*
15. **Insurance** — statutory minimums: workforce (WCF supplement), plant, environmental liability, third-party liability, transit, political risk. Regulator: Tanzania Insurance Regulatory Authority (TIRA). *cadence: annual.*
16. **Local content** — Mining (Local Content) Regulations 2018: community development agreements (CDAs), local procurement quotas (90% local supply by 2030), indigenous workforce ratios, community grievance mechanisms. *cadence: annual reporting to Mining Commission.*
17. **Human rights** — Commission for Human Rights and Good Governance (CHRAGG) + Legal and Human Rights Centre (LHRC) jurisprudence: forced labour, child labour, indigenous rights, security-force conduct under the Voluntary Principles on Security and Human Rights. *cadence: annual audit.*
18. **Telecoms / electronic transactions** — Tanzania Communications Regulatory Authority (TCRA): digital signatures under the Electronic Transactions Act 2015, electronic transaction compliance, data-localisation rules. *cadence: annual.*

For each sub-area the resolver returns: status (green/amber/red/unknown), due date, last filed by, regulator-facing reference number, penalty risk if late, and the document that proves compliance.

---

## 2. Finance (full P&L, never just royalty)

The MD's finance picture spans 12 sub-areas covering income statement, balance sheet, cash flow and treasury linkages.

1. **Profit and loss** — revenue by commodity and site, cost of goods sold, gross margin, operating expense lines, EBITDA, net income. *cadence: monthly close.*
2. **Cash flow** — operating, investing, financing; cash from mining vs cash from ancillary; cash-on-hand, days of runway. *cadence: weekly rollup.*
3. **Working capital** — receivables aging (buyer side), payables aging (suppliers, fuel, payroll), inventory of unsold parcels, bullion stockpile. *cadence: weekly.*
4. **Capex** — equipment plan, drill plan, plant upgrades, exploration capex, replacement vs growth capex split. *cadence: quarterly review.*
5. **Opex** — fuel, explosives, payroll, security, transport, processing fees, regulator filings. *cadence: monthly.*
6. **Tax provisioning** — royalty accrual, CIT provision, VAT receivable/payable, deferred tax. *cadence: monthly accrual, quarterly true-up.*
7. **Treasury position** — TZS / USD / KES balances across BoT gold window, commercial banks, and offshore custodians. *cadence: daily.*
8. **FX exposure** — net USD exposure vs LBMA fix, hedging coverage ratio, intraday delta. *cadence: daily.*
9. **Receivables aging** — by buyer counterparty, by parcel, by days past due. *cadence: weekly.*
10. **Payables aging** — by supplier, by days, statutory vs commercial. *cadence: weekly.*
11. **Inventory / ore stockpile** — head grade, contained metal, mark-to-LBMA valuation. *cadence: weekly.*
12. **Debt and covenants** — facility utilisation, debt service coverage, covenant headroom, BoT or commercial bank limits. *cadence: monthly.*

---

## 3. Operations (full pit-to-port, never just production)

The MD's operations picture spans 11 sub-areas covering the full physical flow.

1. **Production** — tonnage, head grade, recovery, contained metal by site and by shift. *cadence: shift-end (3x daily).*
2. **Shifts and crew** — roster fill rate, absenteeism, overtime hours, foreman sign-off log. *cadence: per-shift.*
3. **Equipment availability** — excavators, haul trucks, generators, drills, primary plant; mean time between failure, OEE. *cadence: daily.*
4. **Fuel** — diesel consumption per tonne moved, bowser stock, theft variance, generator vs haul split. *cadence: daily.*
5. **Drill and blast** — metres drilled, blast holes loaded, powder factor, fragmentation index. *cadence: per-blast.*
6. **Haulage** — cycle time, queue at crusher, road condition. *cadence: per-shift.*
7. **Processing plant** — feed rate, recovery, reagent consumption, plant downtime. *cadence: per-shift.*
8. **Tailings storage** — pond level, freeboard, decant rate, geotech monitoring. *cadence: daily.*
9. **Logistics and transport** — outbound concentrate, dore, bullion to refinery; inbound consumables. *cadence: per-shipment.*
10. **Incident log** — near-miss, lost-time injury, fatality, equipment damage, environmental spill. *cadence: event-driven.*
11. **Maintenance** — planned maintenance compliance, breakdown vs preventive ratio, spares stock-out. *cadence: weekly.*

---

## 4. HR (full workforce, never just headcount)

The MD's HR picture spans 12 sub-areas covering hire-to-retire.

1. **Headcount** — by role, site, contract type, demographic split. *cadence: monthly.*
2. **Shifts and attendance** — biometric clock-in vs roster, absenteeism by site. *cadence: daily.*
3. **Payroll readiness** — gross pay calculation, statutory deductions, net pay, banking instruction. *cadence: monthly.*
4. **Statutory contributions** — NSSF, WCF, PAYE, SDL filed and reconciled. *cadence: monthly.*
5. **Training and CPD** — induction completion, refresher training, regulatory training (PCCB, OSHA). *cadence: annual cycle.*
6. **Certifications expiring** — blast operator, equipment operator, first aid, security guard. *cadence: rolling.*
7. **Open grievances** — formal grievances, mediation, time-to-resolution. *cadence: event-driven.*
8. **Safety incidents** — by severity, by site, by recurrence. *cadence: event-driven.*
9. **Recruiting pipeline** — open requisitions, days-to-fill, cost-per-hire. *cadence: weekly.*
10. **Succession bench** — key-role coverage ratio, identified successors, readiness rating. *cadence: annual review.*
11. **Diversity and inclusion** — gender ratio, regional representation, local-content compliance. *cadence: quarterly.*
12. **Leavers and exit** — voluntary attrition, involuntary attrition, exit interview themes. *cadence: monthly.*

---

## 5. Marketing (full reputation, never just promotion)

The MD's marketing and brand picture spans 8 sub-areas covering the public face of the business.

1. **Brand mentions** — Tanzanian press, regulator press, social, podcasts, industry forums (Mining Indaba, AMCOS gatherings). *cadence: daily monitoring.*
2. **Counterparty perception** — buyer NPS, refiner NPS, off-taker satisfaction surveys. *cadence: quarterly.*
3. **Community sentiment** — village-level perception index from CDA monitoring, grievance volume, local newspaper coverage. *cadence: quarterly.*
4. **Investor communications** — board pack, investor update letter, AGM minutes, regulatory disclosures. *cadence: quarterly.*
5. **Trade show participation** — Mining Indaba (Cape Town), PDAC (Toronto), AMCOS forums (Dar), Mining Commission engagement events. *cadence: annual.*
6. **PR crisis log** — open incidents requiring public statement, statement-issued log, sentiment-recovery curve. *cadence: event-driven.*
7. **Marketplace listings reputation** — buyer feedback on Borjie marketplace, dispute rate, refund rate. *cadence: monthly.*
8. **Digital footprint** — owner-portal sessions, owner-app downloads, website traffic by region. *cadence: weekly.*

---

## 6. Risk (full enterprise risk, never just operational)

The MD's risk picture spans 14 sub-areas covering financial, operational, regulatory and reputational risk.

1. **Operational risk** — equipment failure probability, supply-chain disruption, security incidents. *cadence: monthly.*
2. **Financial risk** — counterparty default, FX, liquidity, debt-service. *cadence: weekly.*
3. **Regulatory risk** — pending policy changes (Mining Act amendments, BoT circulars, TRA notices, NEMC directives). *cadence: ongoing.*
4. **Compliance risk** — open findings from internal audit, regulator enforcement actions. *cadence: rolling.*
5. **Reputational risk** — adverse press, social media incidents, NGO campaigns. *cadence: daily.*
6. **Environmental risk** — tailings dam failure probability, spill exposure, climate-driven (drought, flood) production risk. *cadence: monthly.*
7. **Geopolitical risk** — Tanzania-region political stability, neighbouring-country smuggling risk, sanctions risk. *cadence: monthly.*
8. **Commodity-price risk** — LBMA gold, gem, copper exposure to price moves. *cadence: daily.*
9. **Currency risk** — TZS / USD / KES exposure and hedging coverage. *cadence: daily.*
10. **Counterparty risk** — credit risk on buyers, off-takers, refiners. *cadence: per-transaction screening.*
11. **Cyber risk** — phishing, ransomware, data-loss, BoT cyber-resilience requirements. *cadence: ongoing monitoring.*
12. **Insurance gap** — coverage vs identified risks, deductible exposure. *cadence: annual review.*
13. **Geological risk** — reserve depletion, grade decline, hydrology surprise. *cadence: quarterly.*
14. **Human-capital risk** — key-person dependency, union action, skill-shortage. *cadence: quarterly.*

---

## 7. Treasury (full cash and capital, never just FX)

The MD's treasury picture spans 9 sub-areas.

1. **Cash position** — TZS / USD / KES across BoT gold window, commercial banks, mobile-money float, offshore. *cadence: daily.*
2. **FX hedging** — coverage ratio, hedge instruments, LBMA-fix exposure. *cadence: daily.*
3. **BoT gold window** — utilisation, repatriation status, USD float held with BoT. *cadence: per-window.*
4. **Bank relationships** — facility utilisation, covenants, relationship scoring with NMB, NBC, CRDB, KCB and others. *cadence: monthly.*
5. **Investment portfolio** — surplus cash deployed in TZS T-bills, USD money-market, commercial paper. *cadence: weekly.*
6. **Debt service** — interest and principal due, prepayment options. *cadence: monthly.*
7. **Working capital lines** — overdraft, parcel-finance facility, supply-chain finance. *cadence: weekly.*
8. **Counterparty payment status** — buyer settlement tracking, refiner payout tracking. *cadence: per-shipment.*
9. **Treasury controls** — segregation of duties, dual-signatory thresholds, BoT AML reporting. *cadence: monthly review.*

---

## 8. Geology (full resource, never just current pit)

The MD's geology picture spans 9 sub-areas.

1. **Mineral resource statement** — measured, indicated, inferred tonnes and contained metal per JORC or CRIRSCO. *cadence: annual.*
2. **Reserves** — proven and probable reserves, mine life. *cadence: annual.*
3. **Drill programme** — metres planned, metres drilled, assay turnaround. *cadence: monthly.*
4. **Assay backlog** — pending assays at SGS, Alex Stewart, Bureau Veritas. *cadence: weekly.*
5. **Grade control** — short-term mine planning vs actual head grade. *cadence: per-shift.*
6. **Exploration tenement** — prospecting licences, retention licences, lease areas. *cadence: annual.*
7. **Geotechnical** — pit-slope stability, hydrology, ground support. *cadence: monthly.*
8. **Hydrology** — water-table movement, dewatering pumping rate, water-discharge compliance. *cadence: weekly.*
9. **Resource depletion ratio** — annual extraction vs annual additions from drilling. *cadence: annual.*

---

## 9. Marketplace (full chain-of-custody, never just listings)

The MD's marketplace picture spans 9 sub-areas.

1. **Active listings** — parcels live on Borjie marketplace, grade, ask price, days listed. *cadence: real-time.*
2. **Bids received** — count, average bid-to-ask ratio, top buyer concentration. *cadence: real-time.*
3. **Settlement velocity** — list-to-cash days, dispute rate. *cadence: per-deal.*
4. **Buyer vetting** — KYC status, ICA / LBMA accreditation, sanctions clearance. *cadence: annual recheck.*
5. **Refiner accreditation** — LBMA-good-delivery status, ICA-grade matrix, dore acceptance. *cadence: annual.*
6. **Chain of custody** — pit-to-buyer hash chain in `mineral_chain_of_custody`. *cadence: per-parcel.*
7. **Export documentation** — TRA mineral export certificate, BoT gold-window approval, customs ASYCUDA file. *cadence: per-shipment.*
8. **Price benchmarks** — LBMA AM/PM fix, ICA Brussels gem grading, regional copper, gem auction comps. *cadence: daily.*
9. **Dispute and refund log** — open disputes, resolution time, refund liability. *cadence: event-driven.*

---

## 10. Licences (the operating-licence portfolio)

This is the historical headline view, now ONE domain among fourteen. It still has 8 sub-areas because the MD owns more than the mining titles.

1. **Mining titles** — PML, ML, SML by site, renewal countdown, surface-rent status (Mining Commission). *cadence: annual / 5-yearly.*
2. **Environmental clearance** — EIA decision letters, EMP refresh (NEMC). *cadence: 4-yearly refresh.*
3. **Water permits** — water-use permits from the Basin Water Boards under the Water Resources Management Act 2009. *cadence: 5-yearly.*
4. **Explosives licences** — explosives storage and use licences (Police, Mining Commission). *cadence: annual.*
5. **Workplace registration** — OSHA workplace certificate per site. *cadence: annual.*
6. **Business licences** — district business licence, trading licence (BRELA + local government). *cadence: annual.*
7. **Sectoral permits** — fuel storage, hazardous chemicals, radiation source permits where applicable (TAEC). *cadence: varies.*
8. **Export licences** — BoT gold-window licence, TRA mineral exporter authorisation. *cadence: annual.*

---

## 11. Holdings (the corporate group, never just operating co)

The MD's holdings picture spans 7 sub-areas covering the corporate structure.

1. **Group structure** — parent, op-cos, holdcos, special-purpose vehicles, with shareholding %. *cadence: annual review.*
2. **Beneficial ownership** — ultimate beneficial owners, PEP status, BRELA filing currency. *cadence: annual.*
3. **Inter-company loans** — balances, interest accruals, BoT transfer-pricing documentation. *cadence: quarterly.*
4. **Inter-company services** — management fees, technical services, royalties, with arm's-length documentation. *cadence: quarterly.*
5. **Board composition** — independence ratio, gender ratio, skills matrix, term limits. *cadence: annual.*
6. **Shareholder agreements** — drag, tag, pre-emption, anti-dilution covenants. *cadence: event-driven.*
7. **Group treasury policy** — centralised cash management, dividend policy, capital allocation framework. *cadence: annual.*

---

## 12. Subsidiaries (the operating companies, never just the lead mine)

The MD's subsidiary picture spans 8 sub-areas per entity.

1. **Entity registry** — registered name, BRELA number, jurisdiction, status (active / dormant). *cadence: annual.*
2. **Statutory filings** — annual return, financial statements, audit signoff. *cadence: annual.*
3. **Tax filings** — TRA CIT, VAT, royalty, withholding tax. *cadence: per cadence above.*
4. **Bank accounts** — operating accounts, sweep arrangements, signatories. *cadence: monthly review.*
5. **Workforce and payroll** — entity-scoped headcount, NSSF, WCF. *cadence: monthly.*
6. **Inter-co positions** — receivables and payables to other group entities. *cadence: monthly.*
7. **Licences held** — mining and ancillary licences held by this entity (cross-reference to Compliance + Licences). *cadence: annual.*
8. **Active disputes** — open litigation, regulator actions, contract disputes. *cadence: event-driven.*

---

## 13. Succession (the continuity plan, never just the will)

The MD's succession picture spans 7 sub-areas covering family, leadership and asset transition.

1. **Key-role coverage** — for each C-suite and site-manager role, who is the named successor, readiness rating, time-to-ready. *cadence: annual.*
2. **Family governance** — family council charter, family employment policy, family-only vs professional roles. *cadence: annual.*
3. **Estate planning** — wills, trusts, sharia-compliant arrangements where applicable, life-insurance coverage. *cadence: annual review.*
4. **Ownership transition plan** — share transfer mechanics, valuation methodology, liquidity events. *cadence: 5-yearly review.*
5. **Knowledge transfer** — captured operational knowledge, vendor relationships, regulator relationships per role. *cadence: ongoing.*
6. **Governance documents** — board charter, committee terms of reference, shareholders agreement, family constitution. *cadence: 3-yearly review.*
7. **Continuity risk** — single-point-of-failure inventory, contingency plan per failure mode. *cadence: annual.*

---

## 14. Asset register (every gram and every machine, never just the mine plant)

The MD's asset register spans 9 sub-areas covering the full fixed-asset and inventory footprint.

1. **Fixed assets** — plant, equipment, buildings, with net book value, depreciation schedule. *cadence: monthly close.*
2. **Heavy mobile equipment** — excavators, haul trucks, dozers with serial, ownership, financing status. *cadence: monthly.*
3. **Light equipment** — generators, pumps, drill rigs, mobile crushers. *cadence: monthly.*
4. **IT and OT assets** — servers, mining-domain SCADA, biometric clock-in hardware, owner-app devices. *cadence: quarterly.*
5. **Land and surface rights** — owned, leased, community-grant, with title status. *cadence: annual.*
6. **Bullion and dore inventory** — held at refinery, in transit, in vault. *cadence: per-event.*
7. **Ore stockpile** — in-pit, ROM pad, plant feed, low-grade stockpile, with grade and contained metal. *cadence: weekly.*
8. **Consumables stock** — fuel, explosives, reagents, PPE, with reorder levels. *cadence: weekly.*
9. **Insured asset reconciliation** — assets carried in the register vs assets on the policy schedule. *cadence: annual.*

---

## Cross-cutting rules

- Every sub-area resolves to one of: green, amber, red, unknown.
- "unknown" means the resolver could not reach a data source. The
  FE renders an "Awaiting data" pill; the brain references it as
  "no signal yet on X".
- Every state change is hash-chain-audited per the platform invariant.
- Bilingual labels are mandatory. The catalog stores both; the FE
  picks at render time.
- Tanzanian regulator names are the legal English titles
  (Mining Commission, TRA, NEMC, BoT, BRELA, OSHA, PCCB, etc.).
  The Swahili label uses the Tanzanian convention (Tume ya Madini,
  Mamlaka ya Mapato, etc.) but acronyms remain language-neutral.
- The brain prompt forbids responding to a domain question with a
  single mini_metric. The full picture is the default; the owner
  drills down from there.

---

## Resolver contract

```ts
interface SubAreaStatus {
  status: 'green' | 'amber' | 'red' | 'unknown';
  dueAt?: string;       // ISO date for next obligation
  lastFiledAt?: string; // ISO date for last filing
  refNumber?: string;   // regulator reference / receipt
  evidenceDocId?: string;
  note?: string;        // human-readable detail
}
```

When the resolver has no data source: return `{ status: 'unknown', note: 'awaiting data source' }`.
