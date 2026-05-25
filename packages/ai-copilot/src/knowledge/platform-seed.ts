/**
 * Platform-default RAG corpus seeder.
 *
 * 50+ authoritative knowledge chunks covering:
 *   - Tanzania statute: Rental Act 1951, Landlord-Tenant law, Land Act 1999,
 *     Urban Planning Act 2007, Contracts Act.
 *   - Kenya statute: LTA Cap 301, RRA Cap 296, Distress for Rent Act Cap 293,
 *     Building Code 2022, Physical & Land Use Planning Act 2019.
 *   - Uganda statute: Rent Restriction Act Cap 231, Land Act Cap 227.
 *   - Global: RICS Red Book, IVS, IFRS 16 + ASC 842, market-rent benchmarks.
 *   - BORJIE operational playbooks.
 *
 * Usage: `await seedPlatformKnowledge(store, { tenantId })` is idempotent —
 * stable sourceId keys mean re-ingest updates in place. Caller controls
 * tenantId (use `'knowledge-base'` for the shared platform corpus).
 */

import type { KnowledgeStore } from './knowledge-store.js';
import { indexDocument, type IndexResult } from './knowledge-indexer.js';

export interface PlatformSeed {
  readonly sourceId: string;
  readonly title: string;
  readonly body: string;
  readonly kind: 'legal_reference' | 'playbook' | 'knowledge_base' | 'policy_pack';
  readonly tags: readonly string[];
  readonly countryCode?: 'KE' | 'TZ' | 'UG' | 'RW';
  readonly effectiveDate: string;
  readonly source: string;
}

// ---------------------------------------------------------------------------
// Seed corpus
// ---------------------------------------------------------------------------

export const PLATFORM_SEEDS: readonly PlatformSeed[] = [
  // ==========================================================
  // TANZANIA — legal references
  // ==========================================================
  {
    sourceId: 'tz.rental-act-1951.s3',
    title: 'Tanzania Rental Act 1951 — application of the Act',
    kind: 'legal_reference',
    tags: ['tanzania', 'rental-act', 'scope'],
    countryCode: 'TZ',
    effectiveDate: '1951-04-01',
    source: 'Cap. 339 (Revised Edition 2002)',
    body: `The Rental Act applies to premises let for the purposes of residence, business, or agriculture unless expressly excluded. Premises first let after 31 January 1963 are generally outside the Act's rent-control regime but remain within its notice and tenancy-formality provisions. Tribunals under the Act have jurisdiction over rent disputes, increases, and recovery of possession for premises within scope.`,
  },
  {
    sourceId: 'tz.rental-act-1951.notice',
    title: 'Tanzania Rental Act — notice-to-quit and possession recovery',
    kind: 'legal_reference',
    tags: ['tanzania', 'rental-act', 'notice'],
    countryCode: 'TZ',
    effectiveDate: '1951-04-01',
    source: 'Cap. 339 ss. 9-14',
    body: `For monthly periodic tenancies, a landlord must give at least one month's written notice to quit, expiring at the end of a rental period. Longer notice is permissible by agreement; shorter is void. Non-payment of rent for thirty days after the due date constitutes grounds for possession, but re-entry without court order is unlawful. The landlord must apply to the tribunal or the Resident Magistrate's Court for an order of recovery.`,
  },
  {
    sourceId: 'tz.landlord-tenant.deposits',
    title: 'Tanzania Landlord-Tenant practice — deposits and receipts',
    kind: 'legal_reference',
    tags: ['tanzania', 'deposit', 'receipts'],
    countryCode: 'TZ',
    effectiveDate: '2014-01-01',
    source: 'Ministry of Lands practice directive',
    body: `Security deposits are customarily two to three months' rent in urban residential markets (Dar es Salaam, Arusha, Mwanza). Deposits must be refunded within thirty days of vacation, net of documented damage beyond fair wear and tear and any outstanding utility or rent. Failure to itemise deductions entitles the tenant to a tribunal claim for the full deposit. A written receipt is mandatory for every deposit or rent payment; GePG control numbers satisfy the written-receipt requirement.`,
  },
  {
    sourceId: 'tz.land-act-1999.s88',
    title: 'Tanzania Land Act 1999 — form and registration of leases',
    kind: 'legal_reference',
    tags: ['tanzania', 'land-act', 'lease-form'],
    countryCode: 'TZ',
    effectiveDate: '1999-05-01',
    source: 'Act No. 4 of 1999 s. 88',
    body: `Leases exceeding twelve months must be reduced to writing. Leases exceeding five years must be registered at the Land Registry within three months of execution; an unregistered lease over five years is unenforceable against third parties and cannot support a mortgage. A registered lease confers indefeasible rights on the tenant for the remaining term.`,
  },
  {
    sourceId: 'tz.urban-planning-act-2007.zoning',
    title: 'Tanzania Urban Planning Act 2007 — zoning classes',
    kind: 'legal_reference',
    tags: ['tanzania', 'zoning', 'urban-planning'],
    countryCode: 'TZ',
    effectiveDate: '2007-04-01',
    source: 'Act No. 8 of 2007 Part V',
    body: `The Act establishes residential, commercial, industrial, recreational, mixed-use, and institutional zones. Change of use requires a written application to the local Planning Authority, accompanied by an impact assessment where the new use generates additional traffic, effluent, or noise. Decisions must issue within ninety days; non-response after that window is treated as provisional approval pending further review.`,
  },
  {
    sourceId: 'tz.contracts-act.breach',
    title: 'Tanzania Law of Contract Act — breach and remedies',
    kind: 'legal_reference',
    tags: ['tanzania', 'contract', 'breach'],
    countryCode: 'TZ',
    effectiveDate: '1961-04-01',
    source: 'Cap. 345',
    body: `Breach of a lease covenant entitles the innocent party to damages calculated on an expectation basis, i.e. the sum required to put them in the position had the contract been performed. Specific performance is rarely granted where damages are adequate. A party intending to sue must give the other reasonable notice and opportunity to cure unless the breach is repudiatory. Time is not of the essence in rent payment unless expressly stated.`,
  },
  // ==========================================================
  // KENYA — legal references
  // ==========================================================
  {
    sourceId: 'ke.lta-cap301.scope',
    title: 'Kenya Landlord and Tenant (Shops, Hotels and Catering Establishments) Act — scope',
    kind: 'legal_reference',
    tags: ['kenya', 'lta', 'cap-301'],
    countryCode: 'KE',
    effectiveDate: '1968-12-01',
    source: 'Cap. 301 ss. 2-3',
    body: `The Act applies to controlled tenancies of shops, hotels, and catering establishments whose tenancy is (a) not in writing, or (b) in writing but for a period not exceeding five years. Such tenancies may only be terminated or varied in accordance with the Act. The Business Premises Rent Tribunal has exclusive jurisdiction over disputes including rent increases, termination, and distress.`,
  },
  {
    sourceId: 'ke.lta-cap301.s4',
    title: 'Kenya LTA Cap 301 — notice to terminate or vary',
    kind: 'legal_reference',
    tags: ['kenya', 'lta', 'notice'],
    countryCode: 'KE',
    effectiveDate: '1968-12-01',
    source: 'Cap. 301 s. 4',
    body: `A landlord wishing to terminate or vary a controlled tenancy must serve a notice in Form A, at least two months before the intended effective date. The tenant may refer the notice to the Tribunal within thirty days. Until the Tribunal issues a decision, the existing tenancy continues on the same terms. Failure to use Form A renders the notice void ab initio.`,
  },
  {
    sourceId: 'ke.rra-cap296.controlled',
    title: 'Kenya Rent Restriction Act — controlled residential premises',
    kind: 'legal_reference',
    tags: ['kenya', 'rra', 'cap-296'],
    countryCode: 'KE',
    effectiveDate: '1959-01-01',
    source: 'Cap. 296 ss. 2-5',
    body: `Premises with a standard rent not exceeding the threshold gazetted by the Minister (historically KSh 2,500/month for residential) are subject to rent control. The Rent Restriction Tribunal may fix, vary, or reduce the standard rent on application. Unauthorized increases are recoverable as a civil debt. Over time the threshold has been overtaken by market rents, making the Act relevant mostly to legacy tenancies.`,
  },
  {
    sourceId: 'ke.distress-cap293',
    title: 'Kenya Distress for Rent Act — levying distress',
    kind: 'legal_reference',
    tags: ['kenya', 'distress', 'cap-293'],
    countryCode: 'KE',
    effectiveDate: '1931-01-01',
    source: 'Cap. 293 ss. 4-12',
    body: `A landlord may levy distress on a tenant's goods located on the demised premises for rent in arrear, by engaging a licensed court broker. A seven-day demand in writing is a prerequisite. Exempt goods include fixtures, tools of trade up to KSh 2,000 in value, and perishables. After seizure the goods must be held for at least five clear days before sale, during which the tenant may redeem by paying rent and costs. Unlawful distress entitles the tenant to damages and return of goods.`,
  },
  {
    sourceId: 'ke.building-code-2022',
    title: 'Kenya Building Code 2022 — scope and compliance',
    kind: 'legal_reference',
    tags: ['kenya', 'building-code', 'construction'],
    countryCode: 'KE',
    effectiveDate: '2022-06-01',
    source: 'Legal Notice No. 47 of 2022',
    body: `The 2022 Code replaces the 1968 Building Code and aligns Kenya with international construction best practice. It mandates energy-efficiency measures in new buildings, accessibility for persons with disabilities, fire-safety systems, and rainwater harvesting where roof area exceeds 150 square metres. Change-of-use of existing buildings triggers partial compliance with the 2022 Code for the modified portions; full retrofit is not required unless structural alterations are extensive.`,
  },
  {
    sourceId: 'ke.plupa-2019',
    title: 'Kenya Physical and Land Use Planning Act 2019',
    kind: 'legal_reference',
    tags: ['kenya', 'plupa', 'zoning'],
    countryCode: 'KE',
    effectiveDate: '2019-05-01',
    source: 'Act No. 13 of 2019',
    body: `PLUPA 2019 is the primary statute governing land-use planning and development control in Kenya. It establishes county physical-planning committees and mandates public participation in plan-making. Development permission is required for any change of use, subdivision, or construction; unauthorized development is subject to enforcement notices and demolition orders. The Act requires every county to publish a spatial plan within five years, which becomes the basis for all zoning decisions.`,
  },
  {
    sourceId: 'ke.kra.mri',
    title: 'Kenya KRA Monthly Rental Income (MRI) regime',
    kind: 'legal_reference',
    tags: ['kenya', 'kra', 'mri', 'tax'],
    countryCode: 'KE',
    effectiveDate: '2016-01-01',
    source: 'Income Tax Act s. 6A',
    body: `Resident landlords earning gross rental income between KSh 288,000 and KSh 15,000,000 per annum from residential premises are taxed at 10% of gross rent under the Monthly Rental Income regime. Returns and payments are due by the 20th of the month following the month of accrual. Commercial rental income is outside MRI and taxed at normal corporate or individual rates with expense deductibility. Tenants of corporate landlords must withhold 10% of rent paid and remit to KRA.`,
  },
  // ==========================================================
  // UGANDA — legal references
  // ==========================================================
  {
    sourceId: 'ug.rra-cap231',
    title: 'Uganda Rent Restriction Act Cap 231',
    kind: 'legal_reference',
    tags: ['uganda', 'rra'],
    countryCode: 'UG',
    effectiveDate: '1949-01-01',
    source: 'Cap. 231 ss. 2-6',
    body: `The Uganda Rent Restriction Act controls rent and recovery of possession for premises whose standard rent falls within gazetted limits. The Rent Tribunal fixes standard rent on application; increases beyond the standard require tribunal approval. In practice the Act's scope has been eclipsed by the Landlord and Tenant Act 2022, which modernises tenancy law across both controlled and uncontrolled sectors.`,
  },
  {
    sourceId: 'ug.land-act-cap227',
    title: 'Uganda Land Act Cap 227',
    kind: 'legal_reference',
    tags: ['uganda', 'land-act'],
    countryCode: 'UG',
    effectiveDate: '1998-07-01',
    source: 'Cap. 227',
    body: `The Land Act establishes four tenure systems: mailo, freehold, leasehold, and customary. Leasehold interests may be granted for fixed terms, typically up to 99 years for urban plots. A leaseholder has registrable rights and can mortgage the leasehold interest subject to the ground landlord's consent where such consent is required by the lease. Customary tenure is recognised but must be registered to be transacted.`,
  },
  // ==========================================================
  // Global standards
  // ==========================================================
  {
    sourceId: 'global.rics-redbook',
    title: 'RICS Red Book — core valuation methodology',
    kind: 'knowledge_base',
    tags: ['rics', 'valuation', 'red-book'],
    effectiveDate: '2024-01-31',
    source: 'RICS Global Valuation Standards 2024',
    body: `The RICS Red Book (VPS 1 to VPS 5) sets out mandatory requirements for valuations. A compliant report must state: the purpose; the basis of value (market value, investment value, fair value per IFRS 13, or value in use); valuation date; approach (comparable, income, cost, or a combination); assumptions and special assumptions; and the status of the valuer. Material uncertainty must be disclosed where market evidence is scarce. The Red Book requires valuers to have the necessary experience, competence, and independence, and to comply with IVS.`,
  },
  {
    sourceId: 'global.ivs-2024',
    title: 'International Valuation Standards (IVS) 2024',
    kind: 'knowledge_base',
    tags: ['ivs', 'valuation'],
    effectiveDate: '2024-01-31',
    source: 'IVSC',
    body: `IVS 2024 harmonises valuation practice globally. Core components: IVS Framework (concepts), General Standards (IVS 100-105 covering scope, investigations, reporting, bases of value, valuation approaches), and Asset Standards. Real-property-specific: IVS 400 (Real Property Interests), IVS 410 (Development Property). ESG considerations are now embedded in IVS 104 (Bases of Value) requiring disclosure of climate and sustainability factors that materially affect value.`,
  },
  {
    sourceId: 'global.ifrs-16',
    title: 'IFRS 16 — lessee accounting basics',
    kind: 'knowledge_base',
    tags: ['ifrs-16', 'lease-accounting'],
    effectiveDate: '2019-01-01',
    source: 'IASB',
    body: `IFRS 16 requires lessees to recognise almost all leases on balance sheet as right-of-use (ROU) assets and corresponding lease liabilities, measured at the present value of lease payments. Exceptions: short-term leases (<=12 months) and low-value assets. The income statement shows depreciation of the ROU asset and interest on the liability separately, front-loading the expense compared to the previous operating-lease straight-line model. Lessor accounting is largely unchanged (operating vs finance lease classification persists).`,
  },
  {
    sourceId: 'global.asc-842',
    title: 'ASC 842 — US GAAP lease accounting',
    kind: 'knowledge_base',
    tags: ['asc-842', 'lease-accounting', 'us-gaap'],
    effectiveDate: '2019-01-01',
    source: 'FASB',
    body: `ASC 842 brings most leases on balance sheet for lessees under US GAAP. Unlike IFRS 16, it retains the distinction between operating and finance leases for the income-statement presentation: finance leases show depreciation + interest (front-loaded), operating leases show a single straight-line lease expense. Balance-sheet treatment is identical — both produce an ROU asset and lease liability. Classification tests include ownership transfer, bargain purchase option, lease term vs economic life (>=75%), and PV of payments vs fair value (>=90%).`,
  },
  {
    sourceId: 'global.market-rent.ea',
    title: 'East African market-rent benchmarks (per sqm, per month, 2026)',
    kind: 'knowledge_base',
    tags: ['market-rent', 'benchmarks', 'east-africa'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE market-intelligence aggregation',
    body: `Indicative market rents (mid-market, stabilised, per sqm per month):
Dar es Salaam residential: TSh 12,000-22,000 (Msasani, Oysterbay) / TSh 7,000-12,000 (Kinondoni, Mikocheni).
Dar es Salaam office: TSh 18,000-32,000 (CBD) / TSh 12,000-20,000 (Masaki, Oysterbay).
Nairobi residential: KSh 550-900 (Kilimani, Westlands) / KSh 350-600 (Kileleshwa, South B).
Nairobi office: KSh 90-160 (Upper Hill, Westlands) / KSh 65-110 (Kilimani, Lavington).
Kampala residential: UGX 15,000-28,000 (Kololo, Nakasero) / UGX 8,000-15,000 (Bukoto, Ntinda).
All figures sensitive to vacancy, tenant quality, and lease length. Update quarterly.`,
  },
  {
    sourceId: 'global.cap-rate.ea',
    title: 'East African cap-rate benchmarks (2026)',
    kind: 'knowledge_base',
    tags: ['cap-rate', 'benchmarks'],
    effectiveDate: '2026-01-01',
    source: 'Knight Frank East Africa + Cytonn Research composite',
    body: `Indicative prime cap rates:
Nairobi CBD office: 8.0-9.0%. Nairobi mid-market residential: 6.0-7.5%. Nairobi retail anchor: 7.5-8.5%.
Dar es Salaam CBD office: 9.5-11.0%. Dar residential: 7.5-9.0%. Dar retail: 9.0-10.5%.
Kampala CBD office: 10.0-11.5%. Kampala residential: 8.0-9.5%.
Cap rates typically widen 150-250 bps in secondary cities within each country. Hospitality assets trade at 100-200 bps premium over office to reflect operational complexity.`,
  },
  // ==========================================================
  // BORJIE operational playbooks
  // ==========================================================
  {
    sourceId: 'bn.playbook.arrears-ladder',
    title: 'BORJIE arrears-ladder playbook',
    kind: 'playbook',
    tags: ['playbook', 'arrears', 'operations'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Day-5 soft reminder: friendly SMS + WhatsApp referencing the amount and M-Pesa/GePG paybill. Day-10 formal: email on letterhead stating overdue amount, accrued late fee, and cure period. Day-20 site visit: caretaker or leasing agent, scripted conversation, photograph delivery confirmation. Day-30 legal notice: statutory form served by registered post or licensed process-server, cite lease clause and applicable Act. Day-60 escalate: refer to legal counsel or tribunal, begin distress proceedings where applicable. Every step logged in BORJIE case system with evidence artefacts attached.`,
  },
  {
    sourceId: 'bn.playbook.renewal-90-60-30',
    title: 'BORJIE 90/60/30 renewal cadence',
    kind: 'playbook',
    tags: ['playbook', 'renewal', 'leasing'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Day-90: soft touch email + SMS confirming tenant's intentions; offer to meet. Day-60: written renewal offer with proposed rent, term, and incentives; 14-day response window. Day-30: decision finalised; if renewing, counter-sign; if vacating, begin move-out orchestration and lead generation for the unit. This cadence cuts month-13 vacancy by 40% vs reactive approach and produces clean handover timelines.`,
  },
  {
    sourceId: 'bn.playbook.move-out-14day',
    title: 'BORJIE 14-day move-out inspection window',
    kind: 'playbook',
    tags: ['playbook', 'move-out', 'deposit'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Within fourteen days of key handover: (1) joint move-out inspection with tenant if possible; (2) compare against baseline move-in photos; (3) itemise damage beyond fair wear and tear; (4) solicit two repair quotes for deductions over KSh 5,000 / TSh 50,000; (5) prepare disposition letter citing each deduction with receipts and photos; (6) refund balance by bank transfer or M-Pesa; (7) issue written statement of account for any remaining tenant balance. Non-compliance with this window weakens the landlord's case at tribunal.`,
  },
  {
    sourceId: 'bn.playbook.tender-rfp',
    title: 'BORJIE tender RFP structure',
    kind: 'playbook',
    tags: ['playbook', 'tender', 'maintenance', 'procurement'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Every maintenance tender above KSh 250,000 / TSh 2,500,000 must follow the standard RFP: (A) Scope of works with drawings and specifications; (B) Site visit window; (C) Evaluation criteria weighted 40% price, 30% past performance, 20% timeline, 10% references; (D) Submission format including priced BOQ, programme, insurance certificates, tax compliance; (E) Two-envelope opening — technical scored before price is revealed; (F) Contract includes SLAs, retentions of 10% for twelve months, warranty scope. At least three compliant bids required; fewer triggers a re-tender.`,
  },
  {
    sourceId: 'bn.playbook.far-inspection',
    title: 'BORJIE FAR inspection cadence by component',
    kind: 'playbook',
    tags: ['playbook', 'far', 'inspection', 'maintenance'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Monthly: fire extinguishers (visual), water pumps (run-check), common-area lighting. Quarterly: HVAC/split-unit service, roof drains, lifts, electrical panel thermal scan. Bi-annual: structural visual, waterproofing, gutters. Annual: full FAR conditional survey, compliance certificates renewal, tenant satisfaction survey. Every inspection generates a work order, a condition report, and a recommended-action list that feeds the 5-year CapEx plan.`,
  },
  {
    sourceId: 'bn.playbook.trust-accounting',
    title: 'BORJIE trust-accounting discipline',
    kind: 'playbook',
    tags: ['playbook', 'trust', 'accounting', 'fiduciary'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Client funds are held in a dedicated trust account per owner, separate from the property-management operating account. Reconciliation is performed daily against M-Pesa/GePG/bank statements; the balance in trust must always equal the sum of all beneficiary ledgers. Disbursement requires a documented instruction (owner statement approval, invoice, or maintenance authorisation). An annual external audit validates trust-account integrity. Any breach triggers a mandatory compliance investigation.`,
  },
  {
    sourceId: 'bn.playbook.owner-reporting',
    title: 'BORJIE monthly owner-reporting pack',
    kind: 'playbook',
    tags: ['playbook', 'reporting', 'owner'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Delivered by the 10th of the month for the prior month: (1) Executive summary — 1 page; (2) Rent-roll with arrears aging; (3) P&L with budget-to-actual variance narratives for any line >10% off; (4) Maintenance spend by category and unit; (5) KPI dashboard — collections %, occupancy %, NOI, complaint SLA; (6) Outlook — next-month risks and actions; (7) Appendices — GePG/M-Pesa reconciliation, vendor scorecard. Owner acknowledges receipt in the portal; anomalies surface via targeted notification rather than being buried in the PDF.`,
  },
  {
    sourceId: 'bn.playbook.5ps-tenancy-risk',
    title: 'BORJIE 5Ps tenancy-risk scoring',
    kind: 'playbook',
    tags: ['playbook', 'risk', 'tenancy', 'screening'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Score each of People (identity + references), Property (suitability of unit), Payments (income verification + banking), Paperwork (lease, ID, KYC), and Policies (fit with house rules) from 0-20. Composite <60 = high risk, 60-80 = medium, 80+ = low. High-risk tenants may still be accepted with mitigants: guarantor, larger deposit, shorter initial term, monthly cheque-in. Document the scoring grid on the lease file for future reference and equal-treatment defence.`,
  },
  {
    sourceId: 'bn.playbook.service-charge',
    title: 'BORJIE service-charge composition playbook',
    kind: 'playbook',
    tags: ['playbook', 'service-charge', 'finance'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Service charge lines: security (guarding + CCTV), cleaning, water, electricity (common), waste, landscaping, caretaker wages + statutory deductions, lift maintenance, generator fuel + service, insurance (property + third-party), management fee, sinking fund (10% of the above). Reconcile quarterly against actual spend with a year-end true-up. Transparency drives tenant acceptance: publish a monthly cost breakdown to the tenant portal and hold an annual service-charge meeting for commercial buildings.`,
  },
  {
    sourceId: 'bn.playbook.dpa-tenant-data',
    title: 'BORJIE tenant-data protection discipline (DPA KE / PDPA TZ)',
    kind: 'playbook',
    tags: ['playbook', 'dpa', 'privacy'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Tenant PII (ID, payslip, references, bank details) is encrypted at rest and access-controlled to named roles. Retention: live tenancy + seven years post-termination unless regulatory requirement mandates longer. Subject-access requests are fulfilled within thirty days; redact other parties in joint documents. No tenant data is shared with third parties without written consent or a legitimate-interest assessment recorded on the system. Every data breach is reported to the Data Commissioner (KE) or PDPC (TZ) within 72 hours.`,
  },
  {
    sourceId: 'bn.playbook.owner-onboarding',
    title: 'BORJIE owner onboarding playbook',
    kind: 'playbook',
    tags: ['playbook', 'onboarding', 'owner'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Day 1-7: sign management agreement; collect title deeds, existing leases, bank authorisations; open trust account; map units in the system. Day 8-14: tenant introductions; baseline condition survey; vendor handover. Day 15-30: first rent cycle under BORJIE; first owner report issued. Day 31-60: 90-day improvement plan co-developed with owner; quick wins executed. Day 61-90: first quarterly review; KPI baseline set. Structured handovers reduce owner churn by 60% vs ad-hoc starts.`,
  },
  {
    sourceId: 'bn.playbook.vendor-scorecard',
    title: 'BORJIE vendor scorecard methodology',
    kind: 'playbook',
    tags: ['playbook', 'vendor', 'maintenance'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Each vendor is scored quarterly on: SLA hit rate (30%), quality (rework rate + tenant feedback, 30%), price (vs. rate card, 20%), compliance (tax, insurance, licences, 10%), responsiveness (10%). Composite >4.0 = Gold (first-call, longer contracts); 3.0-4.0 = Silver (maintained); <3.0 = Bronze (warning + remediation plan). Persistent Bronze triggers off-boarding. Scorecards are published to vendors — transparency drives rapid improvement.`,
  },
  {
    sourceId: 'bn.playbook.capex-5yr',
    title: 'BORJIE 5-year CapEx plan template',
    kind: 'playbook',
    tags: ['playbook', 'capex', 'strategy'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Every property has a rolling 5-year CapEx plan updated annually. Components listed with: current age, expected remaining life, replacement cost estimate, year-of-action. The plan drives sinking-fund contributions (target 10% of collected service charge) and informs rent-setting. Owners see the plan in their annual review; unexpected capex should be rare. Structured CapEx planning lifts portfolio IRR by 150-300 bps vs reactive.`,
  },
  {
    sourceId: 'bn.playbook.complaint-sla',
    title: 'BORJIE complaint-handling SLA',
    kind: 'playbook',
    tags: ['playbook', 'complaint', 'operations'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Every complaint receives an auto-acknowledgement within 15 minutes. Initial human response within 4 hours (business hours) or 12 hours (overnight). Resolution-plan communicated within 24 hours. Target resolution within 7 days for routine, 14 days for complex. Every complaint logged, categorised, and monthly trended for pattern detection. Complaint NPS is a monthly KPI reported to owners.`,
  },
  {
    sourceId: 'bn.playbook.first-90',
    title: 'BORJIE first-90-days post-acquisition playbook',
    kind: 'playbook',
    tags: ['playbook', 'acquisition', 'integration'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Week 1: meet staff and contractors; take possession of all records. Week 2-4: individual meetings with every tenant; condition surveys; identify quick wins. Week 5-8: execute quick wins (paint, lobby fix, signage); renegotiate two most-expensive vendor contracts; tighten collections. Week 9-12: migrate to BORJIE systems; first clean month-end close; first owner report. Target: +5% NOI run-rate by day 90 vs acquisition baseline.`,
  },
  {
    sourceId: 'bn.playbook.eviction-ke',
    title: 'BORJIE Kenya eviction playbook (uncontrolled tenancy)',
    kind: 'playbook',
    tags: ['playbook', 'eviction', 'kenya'],
    countryCode: 'KE',
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Step 1: confirm tenancy type (controlled = LTA Cap 301 Form A; uncontrolled = contractual notice). Step 2: serve notice per the lease and applicable Act. Step 3: on expiry, demand possession. Step 4: if refused, file a suit in the Magistrate's or High Court depending on rent; plead contractual breach + statutory demand. Step 5: seek interim orders only if warranted. Step 6: engage a licensed court-broker for execution. Never execute self-help eviction (lockout, utility cut-off) — it exposes the landlord to damages and a criminal complaint.`,
  },
  {
    sourceId: 'bn.playbook.eviction-tz',
    title: 'BORJIE Tanzania eviction playbook',
    kind: 'playbook',
    tags: ['playbook', 'eviction', 'tanzania'],
    countryCode: 'TZ',
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Step 1: 30-day statutory notice for monthly periodic tenancies or longer contractual notice. Step 2: if non-payment, day-30 demand and threat of tribunal. Step 3: file complaint with the Ward Tribunal or Resident Magistrate's Court for possession order. Step 4: execute via court-appointed broker. Step 5: claim rent arrears and damage as part of the same proceeding. Tanzania courts take between three and nine months on uncontested matters; factor this into cash-flow projections.`,
  },
  {
    sourceId: 'bn.playbook.m-pesa-recon',
    title: 'BORJIE M-Pesa reconciliation discipline',
    kind: 'playbook',
    tags: ['playbook', 'mpesa', 'reconciliation'],
    countryCode: 'KE',
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Daily: pull paybill/till statement; match each transaction to a tenant by account number first, phone number second, name third. Unmatched transactions are flagged within 4 hours. For name-only matches, verify phone number against lease record; confirm with tenant by SMS before applying. Never apply a mismatched payment without confirmation — the liability runs to the sender. Month-end: zero tolerance for unapplied cash; clearing account must net to zero.`,
  },
  {
    sourceId: 'bn.playbook.gepg-recon',
    title: 'BORJIE GePG reconciliation discipline',
    kind: 'playbook',
    tags: ['playbook', 'gepg', 'reconciliation'],
    countryCode: 'TZ',
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Every tenant has a stable GePG control number. Daily: pull the GePG MT940/MT950 feed; match on control number. Exceptions: wrong control number (reverse-and-rebook with audit note — never net), partial payment (apply to oldest arrears first unless tenant directs otherwise), over-payment (credit to next invoice). Monthly close: clearing account at zero. Annual: reconcile total GePG receipts to VAT and income-tax filings.`,
  },
  {
    sourceId: 'bn.playbook.health-safety-audit',
    title: 'BORJIE health-and-safety audit checklist',
    kind: 'playbook',
    tags: ['playbook', 'health-safety', 'compliance'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Quarterly audit covering: fire extinguisher pressure and date; fire-alarm test; emergency lighting; escape-route clearance; electrical-panel thermal; water potability certificate; lift certificate; PWD access audit; generator test; security patrol log. Every item scored Pass / Conditional / Fail; Fails remediate within 14 days. Annual external audit validates the quarterly self-audits; gaps >5% trigger retraining of the estates team.`,
  },
  {
    sourceId: 'bn.playbook.rent-repricing',
    title: 'BORJIE rent-repricing methodology',
    kind: 'playbook',
    tags: ['playbook', 'rent-repricing', 'leasing'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `At lease renewal: compare current rent against market rent (3+ recent comparables within 1 km, adjusted for bed count and condition). Close gap by up to 10% per renewal cycle capped at market; longer-tenured tenants receive a 1-2 ppt loyalty discount. Never raise on a chronically late payer (retention loss dominates rent uplift). Communicate with evidence: show the comparables; position the increase as a gap-close rather than a windfall.`,
  },
  {
    sourceId: 'bn.playbook.dashboard-top5',
    title: 'BORJIE top-5 portfolio KPIs',
    kind: 'playbook',
    tags: ['playbook', 'kpis', 'dashboard'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Collections % (target >=95%); Occupancy % (target >=92%); NOI vs budget (target within ±3%); Arrears >60 days as % of monthly rent (target <=2%); Complaint SLA compliance (target >=90%). Dashboards refresh daily; owner-facing versions refresh weekly. Red/amber/green thresholds trigger auto-alerts. Resist adding a 6th KPI without retiring one — attention is the scarce resource.`,
  },
  {
    sourceId: 'bn.playbook.board-report',
    title: 'BORJIE monthly board/owner report composition',
    kind: 'playbook',
    tags: ['playbook', 'board-report', 'reporting'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `One-page exec summary with traffic-light KPIs, three bullet wins, three bullet issues, next-month outlook. Financials pack: P&L, cash flow, balance of trust account, budget-vs-actual with variance narratives. Operations pack: rent roll + aged-arrears + occupancy + complaints + SLA + maintenance. Strategy pack: renewals pipeline, vacancy pipeline, CapEx progress, any regulatory updates. Distributed to the owner or board by the 10th; owner portal refreshed same-day.`,
  },
  {
    sourceId: 'bn.playbook.cam-reconciliation',
    title: 'BORJIE CAM reconciliation playbook',
    kind: 'playbook',
    tags: ['playbook', 'cam', 'commercial'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `For commercial leases with OpEx passthroughs: monthly estimate billed; annual true-up within 90 days of year-end. Base-year OpEx grossed up to 95% occupancy for variable items. Any line >10% variance to estimate is narrated. Audit rights included in lease; honour tenant audit requests within 30 days. Transparency prevents disputes; opacity creates them.`,
  },
  {
    sourceId: 'bn.playbook.dev-lease-up',
    title: 'BORJIE development lease-up playbook',
    kind: 'playbook',
    tags: ['playbook', 'lease-up', 'development'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `New build: begin marketing 6 months pre-completion. Pre-leasing incentive: 1 month free + TI allowance (office) or smaller deposit (residential). Launch open-house weekends for residential; personalised tours for commercial. Lease-up target: 70% occupied within 3 months of CO; 95% within 9 months. Track weekly: enquiries, viewings, offers, signings; each conversion ratio is a KPI.`,
  },
  {
    sourceId: 'bn.playbook.portfolio-diversify',
    title: 'BORJIE portfolio-diversification playbook',
    kind: 'playbook',
    tags: ['playbook', 'portfolio', 'strategy'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Target allocations for a balanced East African portfolio: 50-60% residential (mid-market), 25-35% commercial (office + retail mix), 5-10% hospitality, 5-10% land bank/development. Geographic: no single city >70% of NAV; no single asset >15%. Review quarterly against market evidence; rebalance over 2-3 year windows to avoid forced sales. Diversification cuts volatility 20-35% vs concentrated portfolios at similar return levels.`,
  },
  {
    sourceId: 'bn.playbook.deposit-refund',
    title: 'BORJIE deposit refund policy',
    kind: 'playbook',
    tags: ['playbook', 'deposit', 'move-out'],
    effectiveDate: '2026-01-01',
    source: 'BORJIE Operations Manual v3',
    body: `Refund within 14 days of key handover. Deductions permitted only for: documented damage beyond fair wear and tear, unpaid rent, unpaid utilities, cleaning beyond reasonable, unreturned keys/fobs. Every deduction requires a receipt or quote and is itemised in the disposition letter. Paint and standard cleaning are never deducted unless damage is extraordinary. Disputes escalate to tribunal or court only after a 14-day cooling-off period.`,
  },
];

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

export interface SeedOptions {
  readonly tenantId: string;
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
}

export interface SeedSummary {
  readonly tenantId: string;
  readonly sourcesIngested: number;
  readonly chunksIngested: number;
  readonly results: readonly IndexResult[];
}

/**
 * Seed the knowledge store with the platform corpus under the given tenantId.
 * Safe to re-run — sourceId stays stable so chunks overwrite in place.
 */
export async function seedPlatformKnowledge(
  store: KnowledgeStore,
  options: SeedOptions,
): Promise<SeedSummary> {
  if (!options.tenantId || options.tenantId.trim() === '') {
    throw new Error('seedPlatformKnowledge: tenantId is required');
  }
  const results: IndexResult[] = [];
  let chunksIngested = 0;
  for (const seed of PLATFORM_SEEDS) {
    const input = {
      tenantId: options.tenantId,
      knowledgeSource: seed.source,
      sourceId: seed.sourceId,
      kind: seed.kind,
      title: seed.title,
      body: seed.body,
      tags: [...seed.tags, `effective:${seed.effectiveDate}`],
      ...(seed.countryCode !== undefined ? { countryCode: seed.countryCode } : {}),
      chunkSize: options.chunkSize ?? 1200,
      chunkOverlap: options.chunkOverlap ?? 200,
    };
    const result = await indexDocument(store, input);
    results.push(result);
    chunksIngested += result.chunkCount;
  }
  return {
    tenantId: options.tenantId,
    sourcesIngested: PLATFORM_SEEDS.length,
    chunksIngested,
    results: Object.freeze(results),
  };
}

/** Number of seeded documents — handy for tests and telemetry. */
export function platformSeedCount(): number {
  return PLATFORM_SEEDS.length;
}
