# BORJIE101 — Research Answers

**Date:** 2026-04-18
**Scope:** Decision-ready briefing answering the 10 open research questions raised in `Docs/requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md`.
**Excludes:** Property-graph research (already covered in `Docs/RESEARCH_REPORT_CPG.md`).
**Method:** Web research (primary sources where possible) — current year 2026.

---

## Q1. Professional property-class taxonomy (global + East African variants)

### Question (restated)
How do SOTA commercial real-estate platforms classify property types? What hierarchy works for mixed-use portfolios that must also accommodate East African realities (bareland, warehouses/godowns, villas, hostels)? Recommend a default taxonomy for BORJIE with org-customizable extensions.

### Answer
SOTA platforms converge on a two-level model: a small, stable set of **primary asset classes** (usually 6–8) and a larger, open-ended set of **sub-types**. Yardi Voyager ships six primary variants — Commercial, Residential, Affordable Housing, PHA, Senior Housing, plus Commercial sub-verticals (office, retail, industrial, mixed-use) — and treats sub-classifications as configurable attributes on the property record rather than hard-coded enums. AppFolio and Buildium follow the same pattern but with a flatter top level (Residential / Commercial / Association / Student / Affordable).

At the measurement level, **IPMS (International Property Measurement Standards)**, jointly owned by RICS, BOMA, CoreNet Global and ~80 other bodies, defines canonical asset classes: Office, Residential, Industrial, Retail, and a mixed-use composition rule. These are the authoritative global labels you should align with.

East African idiosyncrasies that generic taxonomies miss:
- **Bareland / undeveloped land** (speculation, agricultural, peri-urban plots) is a first-class asset type in TZ/KE, not a sub-type.
- **Godown** is the common East African term for warehouse/light-industrial storage; it needs its own label even if it maps to "Industrial" globally.
- **Hostel** (student or worker dorm) overlaps with "Student Housing" but trades in much smaller units with shared amenities.
- **Villa / standalone house** vs. **apartment in a block** is a rent-setting distinction landlords routinely make.
- **Guesthouse / serviced-apartment** hybrids (short-term + long-term) are common and blur residential/hospitality.

### Recommendation for BORJIE
Ship a two-level taxonomy with an `extensible` flag:

**Level 1 (locked, 7 classes):** Residential, Commercial, Industrial, Land, Hospitality, Mixed-Use, Special-Purpose.

**Level 2 (seeded defaults, org-extensible):**
- Residential → Apartment, Villa, Bungalow, Townhouse, Hostel-Room, Serviced-Apartment, Single-Room.
- Commercial → Office, Retail-Shop, Kiosk, Boutique, Bank-Branch.
- Industrial → Warehouse, Godown, Light-Industrial, Factory, Cold-Storage.
- Land → Bareland-Residential, Bareland-Commercial, Agricultural, Peri-Urban-Plot.
- Hospitality → Guesthouse, Lodge, Short-Let-Unit.
- Mixed-Use → Composition ref (sums Level-1 shares).
- Special-Purpose → Church, School, Clinic, Petrol-Station.

Store both the canonical IPMS class and the vernacular label (e.g. `{class: "industrial", vernacular: "godown"}`) so global reporting works and local UX feels native. Expose Level-2 as a soft-deletable, org-scoped reference table.

### Sources
- [Voyager Suite — Yardi](https://www.yardi.com/suite/voyager-suite/)
- [Voyager Commercial — property type coverage](https://www.yardi.com/product/voyager-commercial/)
- [RICS International Property Measurement Standards](https://www.rics.org/profession-standards/rics-standards-and-guidance/sector-standards/valuation-standards)
- [BOMA standard methods of measurement](https://www.buildingengines.com/blog/boma-standard-methods-of-measurement/)
- [East Africa Real Estate market overview — JLL](https://www.jll.com/en-us/insights/market-perspectives/east-africa-real-estate)

---

## Q2. GePG integration + Tanzanian real-estate compliance basics

### Question (restated)
How does GePG (Government electronic Payment Gateway) actually work for a SaaS? Control-number issuance, reconciliation, refunds, SP onboarding. Plus compliance basics: Land Act, Rent Restriction Act, LPMS schema.

### Answer
**GePG is a centralised, government-run payment hub** connecting all Tanzanian banks and MNO wallets (M-Pesa, Tigo Pesa, Airtel Money, Halopesa) to public and private billers. It is operated by the Ministry of Finance & Planning. For a SaaS like BORJIE, the relevant flows are:

1. **Bill posting** — the SaaS (as a registered "Service Provider" / SP, or via a certified PSP) POSTs a bill to the GePG *Bill & Payment Information Posting API* (v3.0). GePG returns a **control number** that the tenant can pay against at any channel.
2. **Payment notification** — once paid, GePG calls back with a payment-posted message. Reconciliation is automated against the original bill ID.
3. **Reversal / refund** — the bank requests approval from the SP and notifies GePG with the control number or transaction ID. There is no instant refund; it is a human-reviewed flow.

**Onboarding process** (from GePG SOP, Jan 2020): (a) application letter to the Permanent Secretary, Ministry of Finance & Planning; (b) sensitisation session; (c) procurement engagement; (d) technical integration against sandbox; (e) sign SP contract; (f) go-live. Expect 3–6 months. Many SaaS vendors instead piggyback on an already-integrated PSP (ClickPesa, Selcom, Azampay) — faster but adds a fee layer.

**Compliance basics:**
- **Land Act 1999 + Village Land Act 1999** govern land tenure; most property is held under a **Right of Occupancy** (not freehold). BORJIE should capture RO certificate number, grant date, term, and issuing authority.
- **Rent Restriction Act (Cap. 339)** caps advance rent at 2 months' "standard rent" without Ward Tribunal consent; deposits are refundable with interest; eviction for non-payment requires Ward Tribunal approval. Violations are criminal offences. This directly shapes deposit and advance-rent UX.
- **TRA** requires 10% withholding on gross rent (paid by tenant/agent, remitted monthly), VAT 18% on commercial rent above TZS 100M annual turnover, and property tax (0.15% residential / 0.20% commercial in Dar).
- **LPMS** (Land Management Information System) is the Ministry of Lands' registry — the canonical source of parcel/plot numbers. BORJIE should accept plot numbers in LPMS-compatible format (`Plot No. / Block / LO Number`) and display them on contracts.

### Recommendation for BORJIE
- Integrate **via a certified PSP first** (ClickPesa or Azampay) to reach market in weeks, not quarters. Plan direct GePG SP integration as a Phase-2 project for margin recovery at scale.
- Model a `BillingIntent → ControlNumber → PaymentNotification` state machine; never treat a control number as "paid" until the posted-payment callback arrives.
- Build compliance hard-stops into lease creation: block > 2 months advance rent without a "Tribunal consent attached" flag; auto-compute 10% WHT on invoice and generate the monthly TRA remittance report; auto-flag commercial leases crossing TZS 100M turnover for VAT registration.
- Store RO certificate numbers and plot numbers in LPMS format, both on the parcel and on the generated lease PDF.

### Sources
- [GePG Standard Operation Procedure (Jan 2020)](https://www.gepg.go.tz/wp-content/uploads/2020/01/GePG-STANDARD-OPERATION-PROCEDURE-SOP-JAN-2020.pdf)
- [GePG Bill & Payment Posting API v3.0](https://www.gepg.go.tz/wp-content/uploads/2019/02/API-BillAndPaymentInformationPostingAPIv3.0.pdf)
- [Understanding GePG — ClickPesa](https://clickpesa.com/understanding-gepg-in-tanzania-what-it-is-how-it-works-and-why-it-matters/)
- [Rent Restriction Act (Cap. 339) — TanzLII](https://tanzlii.org/akn/tz/act/1984/17/eng@2002-07-31)
- [Land Act 1999 — FAO legal text](https://faolex.fao.org/docs/pdf/tan23795.pdf)
- [Tanzania tax rates — TanzaniaInvest](https://www.tanzaniainvest.com/tax)

---

## Q3. State-of-the-art rent-collection gamification

### Question (restated)
What gamification mechanics for rent collection actually work? Points, early-pay discounts, streak-based credit scores. Case studies from Bilt, Till, Stake, RentPerks. What sticks, what fails, what is culturally viable in East Africa.

### Answer
The most mature proptech loyalty system is **Bilt Rewards** (4M+ members, 2M+ units in the "Bilt Alliance"). Its mechanics: points earned on every on-time rent payment, redeemable for travel, fitness, rent credits, or a down-payment fund. 2026 evolution extends rewards to neighbourhood spend and renewal moments. Key principle: **convert a recurring grudge payment ("Rent Day") into a positive behavioural cue.** Landlords/owners in the Alliance report it as a retention lever, not a cost centre, because the network effect drives renewal.

**Till Financial** (acquired by Best Egg, 2025) went in a different direction: rather than reward on-time payment, it **split rent into flexible sub-instalments** aligned to tenant pay-cycles. Case study from ACRE: "significantly reduced turnover" and cleaner revenue visibility, without punitive late fees. Till proves a counter-thesis — the highest-leverage intervention is often **cash-flow alignment**, not rewards.

**Stake** (NYC/DC) pays 1–3% cashback into a savings account on every rent payment and has shown a meaningful correlation with on-time payment and renewal rates.

**RentPerks** is smaller-scale: gift-card style rewards at rent-payment time.

**What sticks (evidence-based):**
- Positive reinforcement per on-time event (points/cashback) beats penalties on retention.
- Flexible instalments reduce delinquency without eroding revenue.
- Rewards tied to **aspirational** goals (travel, homeownership path) outperform generic cashback.

**What fails:**
- A 2019 randomized pilot across behavioural-economics incentive structures found *no single design* outperformed a flat constant incentive on enrollment/retention — novelty alone is not enough.
- Complex streak/gamification that requires tenant effort (log in, claim) decays within weeks.
- Rewards that cost more than the saved collection friction are net-negative.

**East Africa viability:**
- Airtime, data bundles and M-Pesa cashback are culturally fluent and have near-zero redemption friction — far better than foreign loyalty currencies.
- "Build your rental credit score" framing resonates in markets where formal credit scoring is thin. A streak-based score usable as a deposit waiver or rent discount at renewal is a high-leverage idea.
- Group/community gamification (tenant associations, referral bonuses) is culturally viable where individual gamification feels transactional.

### Recommendation for BORJIE
Ship a three-layer gamification module, all org-configurable:
1. **"Tenant Score"** — streak-based, 0–1000, rising with on-time payments, falling with late/broken leases. Surface it to landlords (screening) and tenants (renewal discount tiers). This is defensible and behaviour-changing even without cash rewards.
2. **Early-pay / on-time incentive** — configurable per-property; default is a 1–2% credit against next month's rent, not a cash payout. Minimises margin hit.
3. **Airtime / M-Pesa cashback partnership** — optional monetised tier for premium plans, run through an MNO partnership so BORJIE does not carry the redemption P&L.

Do **not** ship complex streaks/quests in v1 — evidence says they decay. Do ship the tenant-score because its second-order effect (screening signal) has commercial value regardless of whether tenants engage.

### Sources
- [Bilt Rewards — Real Estate Use Case (COI)](https://councilofinnovation.com/impact-stories/rent-payment-loyalty-ecosystem/)
- [Bilt Alliance 2025 highlights](https://newsroom.biltrewards.com/alliance25highlights)
- [Till Financial acquired by Best Egg](https://www.multifamilyexecutive.com/technology/best-egg-enhances-its-portfolio-with-acquisition-of-rent-platform-till_o)
- [Till / ACRE founder Q&A](https://www.metaprop.com/blog/founder-q-till-helping-renters-and-landlords-navigate-covid-19-crisis)
- [Behavioral-economics incentive RCT (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6580090/)

---

## Q4. AI-mediated price-negotiation patterns used by SOTA proptech

### Question (restated)
How do Airbnb, Apartments.com and modern lease platforms handle automated negotiation? Bounded-range, policy-constrained LLM, deal-making protocols. What patterns should BORJIE adopt?

### Answer
Honest framing first: **most SOTA platforms do not let AI negotiate price end-to-end.** EliseAI — the dominant AI leasing assistant (75% of operators projected end-to-end automated by end of 2026) — explicitly hands off to humans "when negotiations get tricky." The mainstream pattern is **AI-prepared, human-approved**:
- AI drafts counter-offers inside a landlord-set range.
- AI explains the range to the tenant ("this is 5% under market for this unit class").
- Final "yes" is a human click, even if the AI composed every word.

Propaya and Prophia focus on **lease abstraction and benchmark intelligence**, not active negotiation — they give the human negotiator the numbers to win.

**Emerging research (2025–2026)** on agent-to-agent negotiation flags real dangers: a weaker buyer agent paid ~2% more against a stronger seller agent, and agents have been shown to violate user-set budget constraints ("committed to $900 on a $500 budget"). The industry response is a **layered guardrail architecture** (Arthur AI, Pactum):
- **Pre-LLM guardrails** — hard-coded floors/ceilings, red-line clauses, margin thresholds.
- **In-prompt policy** — system prompts enumerate allowed concession ladders ("may offer 1 month free, then 2 weeks free, then $100/mo discount").
- **Post-LLM guardrails** — output validation (regex/schema) to kill offers that violate bounds before they reach the counterparty.
- **Human-in-loop** on any offer outside the bounded region.

Pactum (enterprise procurement) is the clearest implementation: it trains LLM agents on a **playbook** (price/payment-term boundaries + red-lines) and the agent only operates inside that sandbox.

### Recommendation for BORJIE
Adopt the **Pactum/EliseAI hybrid**:
1. Every lease has a **landlord-authored negotiation policy**: floor rent, ceiling concession, allowed incentives (months free, deposit waiver, M-Pesa cashback), red-lines (no pet exceptions, minimum 12-month term, etc.).
2. The AI negotiates inside this sandbox with the tenant via WhatsApp/email.
3. **Two-layer guardrail**: (a) structured output — every offer is a JSON `{rent, term, concessions[]}` validated against policy before it reaches the tenant; (b) LLM system prompt enforces the same in natural language.
4. Any counter-offer that would exit the sandbox is routed to the landlord for one-click approval/rewrite.
5. Log every offer + tenant response as an auditable `NegotiationEvent` chain — essential for dispute defence and for training future pricing models.

Ship this as **assistive** in v1 ("AI drafts, you approve"); promote individual clauses to **autonomous within bounds** only after you have 1000+ supervised rounds to calibrate against.

### Sources
- [EliseAI — 75% automated leasing by 2026](https://eliseai.com/blog/75-of-operators-will-have-automated-leasing-end-to-end-by-2026--what-happens-to-the-25-who-havent)
- [When AIs bargain, a weaker agent costs you — MIT Tech Review](https://www.technologyreview.com/2025/06/17/1118910/ai-price-negotiation/)
- [Agent-to-Agent Negotiations benchmark (arXiv 2506.00073)](https://arxiv.org/html/2506.00073)
- [Arthur AI — Agent guardrails best practices](https://www.arthur.ai/blog/best-practices-for-building-agents-guardrails)
- [Pactum — AI procurement negotiation](https://pactum.com)

---

## Q5. Post-lease usage-monitoring vectors beyond annual audits

### Question (restated)
What are cost-effective ways to monitor how a property is being used after a lease starts, beyond the annual audit? Tenant feedback, IoT, satellite, site visits, automated compliance checks — fit for Tanzania's limited IoT penetration.

### Answer
Think of monitoring as a **layered portfolio** where cost rises with fidelity, and pick the right layer per asset class.

**Layer 1 — Passive/zero-marginal-cost (ship for all units):**
- Rent-payment cadence itself is a usage signal; sudden late-payment streaks correlate with tenant distress or sublet.
- Maintenance-request volume and themes (e.g. repeated plumbing = occupancy density up).
- Utility bill parsing (if the landlord owns the meter) — consumption spikes reveal subletting or commercial use in a residential unit.

**Layer 2 — Light-touch digital (low cost, high coverage):**
- Quarterly tenant micro-surveys (3–5 questions, WhatsApp). Industry best practice: annual comprehensive + quarterly pulse.
- Neighbour/community reporting channel (tenant associations are strong in TZ).
- Scheduled virtual check-ins — tenant uploads a short video walk-through every 6 months. Low adoption-friction if tied to a small credit.

**Layer 3 — Targeted physical (medium cost, use on high-value assets):**
- Bi-annual site visit on commercial/industrial and premium residential.
- Move-cycle inspections (move-in, mid-lease, move-out) with AI-assisted photo comparison — more on this in Q6.

**Layer 4 — IoT (capex-heavy, reserve for enterprise tier):**
- Smart water / electricity sub-metering is the **highest-signal IoT** for TZ because utility sub-metering is a common landlord-tenant dispute already, so the ROI justifies itself. LoRa / NB-IoT is cost-viable in Dar / Arusha / Mwanza (KSh/TZS equivalents to tens of USD per meter per year). eWATERPay and similar vendors prove the model.
- Door/occupancy sensors and smart locks are over-spec for most TZ residential.

**Layer 5 — Satellite (targeted, very cost-effective for land):**
- Digital Earth Africa (free) and Planet Labs / Maxar (paid) provide sub-metre imagery sufficient to detect unauthorised construction, illegal subdivision, and changes in land use — **highly relevant for bareland in BORJIE's portfolio.**
- Annual or semi-annual change-detection is cost-effective; no per-property hardware.

### Recommendation for BORJIE
Ship **Layers 1, 2 and a scoped piece of Layer 5** in v1:
- **Usage-anomaly detection** on payment, maintenance and utility signals; surface as a landlord alert.
- **Quarterly WhatsApp pulse survey** (auto-scheduled, NPS + 3 custom Q).
- **Annual satellite change-detection job** for every bareland and low-density-residential parcel; flag boundary/structure changes to the landlord. Use Digital Earth Africa + a commercial tile when higher res is needed. Budget ~USD 2–5/parcel/year.

Hold Layer 4 (IoT) for an enterprise add-on once you have an anchor customer that will co-fund the hardware. Do not ship sensors into v1 — margin will bleed.

### Sources
- [Digital Earth Africa — free satellite platform](https://digitalearthafrica.org/en_za/)
- [How governments track land use with Planet imagery](https://www.planet.com/pulse/how-governments-track-changing-land-use-with-planet-near-daily-satellite-imagery/)
- [IoT smart water metering — transforming rentals in Kenya](https://shiftenant.com/blogs/the-rise-of-iot-in-smart-water-management-transforming-renting-and-real-estate-in-kenya)
- [Tenant satisfaction survey frequency best practices](https://www.buildingengines.com/blog/how-to-measure-tenant-satisfaction/)
- [Infrastructure quality assessment in Africa via satellite + DL](https://www.researchgate.net/publication/325557717_Infrastructure_Quality_Assessment_in_Africa_using_Satellite_Imagery_and_Deep_Learning)

---

## Q6. Move-out damage assessment workflows (evidence + dispute handling)

### Question (restated)
Best-in-class move-out damage workflows: photo/video standards, AI-assisted scoring, deposit deduction, defensible audit trails.

### Answer
The mature pattern is a **paired-inspection / change-detection model**:

1. **Move-in baseline** — structured photo/video capture by checklist (every room, every item). Date-stamped, GPS-verified. Tenant countersignature.
2. **Move-out capture** — same checklist, same angles.
3. **AI comparison** — models like Paraspot AI and RentSolve AI automatically pair items, classify changes (normal wear vs. damage), assign severity, and produce a *court-ready* condition report. RentSolve specifically advertises "court-ready" output and automatic flagging of items whose condition changed.
4. **Itemised deduction proposal** — each flagged item ties to a repair cost estimate (often sourced from a landlord's vendor catalogue).
5. **Tenant dispute flow** — tenant has N days to contest any line item; dispute escalates to human review with all evidence attached.
6. **Immutable audit trail** — append-only log of capture, model output, deductions, disputes, resolutions, with original media hashes.

Evidence-standard requirements learned from deposit-protection case law (UK DPS, US small-claims):
- **Date and GPS stamps** on every image.
- **Unedited originals** preserved alongside any derived/annotated versions.
- **Witnessed or countersigned** move-in baseline.
- **Reasonable wear-and-tear** benchmarks documented (tenancy length, property type).

Paraspot and RentSolve are the pure-play specialists. Yardi and RealPage have inspection modules but they are thinner on AI comparison; most large operators pair Yardi with a Paraspot-class vendor.

### Recommendation for BORJIE
Ship this workflow in v1 (it is a visible differentiator and the dispute-defence value is high in the Tanzanian legal context):

1. **Structured capture app** — mobile, offline-first, checklist-driven. Enforce `[room][item][angle]` naming; embed EXIF datetime + coarse GPS.
2. **Baseline lock** — on move-in, tenant e-signs (or SMS-OTPs) the evidence bundle; the bundle hash is persisted on the lease record.
3. **Pair-and-diff** — integrate a vision model (start with off-the-shelf multi-modal LLM, e.g. Gemini or Claude, for severity scoring; graduate to a specialist API like Paraspot if volume justifies).
4. **Deduction ledger** — every deduction is one row with: before-photo, after-photo, AI score, human override, repair quote, line-total. Tie to an itemised vendor-cost catalogue per org.
5. **Dispute state machine** — `proposed → tenant_objected → owner_responded → tribunal / agreed`. Every transition is signed and timestamped.
6. **Audit bundle export** — one PDF + media zip, ready for the Ward Tribunal / District Land & Housing Tribunal. This is the "defensible" output.

Reasonable wear-and-tear defaults: depreciate paint / fittings / appliances on a standard schedule (paint: 3 yrs; appliances: 7 yrs; flooring: 10 yrs) and surface the depreciated value as the max deduction ceiling — visible to both parties to pre-empt disputes.

### Sources
- [Paraspot AI — remote property inspections](https://www.paraspot.ai/)
- [RentSolve AI — move-in/out comparison](https://rentsolve.ai/features/move-in-move-out-inspection)
- [Zillow Rental Manager — move-out inspection guide](https://www.zillow.com/rental-manager/resources/inspection-for-rental-property/)
- [Deposit Protection Service — common dispute questions](https://www.depositprotection.com/learning-centre/disputes/common-dispute-questions)
- [Best AI tools for property inspection workflows — Syntora](https://syntora.io/solutions/the-best-ai-tools-for-streamlining-property-inspection-workflows-for-small-prope)

---

## Q7. Bad-history thresholds for non-renewal triggers (legally defensible, jurisdiction-aware)

### Question (restated)
What counts as "bad history" under Tanzanian tenancy law? Late-rent streaks, unauthorised sublet, damage, dispute frequency. Suggested default thresholds + org-configurability.

### Answer
Tanzanian tenancy law matters here because the Rent Restriction Act (Cap. 339) and Land Act 1999 make **non-renewal** and **eviction** meaningfully different regulated events:

- **Eviction** for cause (non-payment, material breach) requires **Ward Tribunal** approval. Evidence-heavy. Can be contested up to the District Land & Housing Tribunal and the High Court.
- **Non-renewal** at the end of a fixed term is landlord-permissive with **proper notice** (locally 30–90 days is standard contract practice). Much lower evidentiary bar but still challengeable if it appears discriminatory or retaliatory.

US/UK comparable categories of "bad history" that drive non-renewal (per rental-history/screening sources):
- Chronic late payment (even if eventually paid).
- Prior eviction filing (even without judgment).
- Property damage resolved without lawsuit.
- Cash-for-keys departures.
- Lease-violation patterns (unauthorised occupants, pets, subletting, noise).
- Dispute frequency (repeated formal complaints).

**What's legally defensible** (US precedent, analogous): the more a non-renewal decision is supported by **pre-defined, uniformly applied, written thresholds**, the less vulnerable it is to a retaliation/discrimination claim. Arbitrary human "I don't want to renew" is legally riskier than "per policy, 4+ late payments in 12 months triggers non-renewal".

### Recommendation for BORJIE
Ship a **configurable Tenant-Risk policy** per org, with sensible TZ-tuned defaults. Every trigger must be evidence-linked and auditable.

Suggested default thresholds (org-overridable):
- **Late-pay pattern:** ≥ 4 payments > 7 days late in any rolling 12-month window → non-renewal eligible.
- **Severe late-pay:** ≥ 2 payments > 30 days late in any 12-month window → non-renewal eligible + requires landlord review.
- **Chronic late-pay:** ≥ 8 payments > 3 days late → *warning*, surfaced to tenant.
- **Unauthorised sublet:** single confirmed instance (evidence: inspection photo + third-party statement) → eviction-eligible.
- **Property damage:** single incident > 25% of monthly rent in damages (net of normal wear) AND unresolved after 30 days → eviction-eligible.
- **Disputes:** ≥ 3 formal complaints opened by tenant or neighbours in 12 months → flag for manual review, NOT auto-non-renewal (high false-positive risk).
- **Compliance:** any criminal use of premises → immediate legal-team escalation.

Computed automatically from the `PaymentLedger`, `IncidentLog` and `InspectionLog`. Surface as a **risk score** on the tenant profile with a full explain-trace (which events contributed, with evidence links). Crucially, **the system never auto-executes non-renewal** — it pre-fills a recommended notice letter and sends it to the landlord for review. That preserves the legally-defensible "policy-driven but human-decided" posture.

Localisation knob: different TZ regions have different Ward Tribunal cultures — expose the thresholds per-org so commercial landlords can run tighter rules than social-housing landlords.

### Sources
- [Rent Restriction Act (Cap. 339)](https://tanzlii.org/akn/tz/act/1984/17/eng@2002-07-31)
- [Understanding Lease and Tenancy Laws in Tanzania](https://generisonline.com/understanding-lease-and-tenancy-laws-in-tanzania-a-comprehensive-guide/)
- [Is non-renewal of lease the same as eviction? — Azibo](https://www.azibo.com/blog/is-non-renewal-of-lease-the-same-as-eviction)
- [Rental history screening — RentSpree](https://www.rentspree.com/blog/how-long-does-a-bad-rental-history-stay-on-your-record)
- [Can a landlord evict for property damage — Compliance Prime](https://www.complianceprime.com/blog/2024/04/08/can-your-landlord-really-evict-you-for-damage/)

---

## Q8. "Nanobanana" document generation — is this real? What is it?

### Question (restated)
Search for "Nanobanana" document generation. If it is Google's Gemini image gen, confirm. Assess fit for estate-management documents (contracts, letters, invoices, notices). If the voice-memo claim is wrong, flag it and recommend alternatives.

### Answer
**Flagging a correction to the voice memo:** "Nanobanana" is **not** a document-generation tool. It is Google DeepMind's brand for **Gemini image-generation models**:
- **Nano Banana** = Gemini 2.5 Flash Image.
- **Nano Banana 2** = Gemini 3.1 Flash Image.
- **Nano Banana Pro** = Gemini 3 Pro Image (advertised for infographics, diagrams, 1K–4K renders with strong in-image text rendering).

Nano Banana Pro *can* render text legibly inside images and is excellent for diagrams, marketing assets and infographics. It is **not** designed to produce legally-structured documents (contracts, invoices, notices) — those want deterministic layout, precise typography, formula/field support, and an editable output (DOCX/PDF), none of which are image-model strengths. Using it for contract generation would be unorthodox, hard to version-control, and a compliance/auditability risk.

**What BORJIE actually needs** for estate-management documents is a **templated document-generation pipeline**, not an image model:

| Need | Best-in-class approach |
|---|---|
| Contract / lease PDFs with merge fields | Docx template + engine (docxtemplater, WeasyPrint, Typst, or LaTeX) |
| Invoices / receipts | Same template engine, locale-aware (TZS, TZ tax lines) |
| Legal notices (non-renewal, eviction, rent increase) | Static templates with merge fields + e-sign flow |
| E-signature | DocuSign, Dropbox Sign, or local e-sign provider recognised by TZ e-Transactions Act |
| AI-drafting of **bespoke clauses** | LLM (Claude/Gemini/GPT) constrained to a clause library, output inserted into the template — never free-form document generation |
| Brand imagery / infographics for marketing | **This** is where Nano Banana Pro actually fits |

### Recommendation for BORJIE
- **Do not** rely on Nano Banana for contract generation. Correct the voice-memo assumption in the next PRD revision.
- Build a **template-first doc system** using `docxtemplater` (or Typst for programmatic typography) + `@react-pdf/renderer` for on-screen preview. Store templates per-org with version history.
- Use LLMs (Claude Sonnet/Opus) to **fill clauses** and **draft cover letters** from structured fields — never to generate whole documents ab initio, which fails compliance audit.
- Integrate a TZ-recognised e-signature provider. The Electronic Transactions Act 2015 (TZ) recognises e-signatures if they reliably identify the signer and indicate intent.
- **Use Nano Banana Pro where it excels**: marketing imagery, property flyers, dashboard infographics, diagram generation. That is a legitimate and useful scope for it.

### Sources
- [Nano Banana Pro — Google DeepMind](https://deepmind.google/models/gemini-image/pro/)
- [Nano Banana 2 — Google blog](https://blog.google/innovation-and-ai/technology/ai/nano-banana-2/)
- [Gemini image generation — Google AI for Developers](https://ai.google.dev/gemini-api/docs/image-generation)
- [Where to use Nano Banana Pro — Google blog](https://blog.google/products/gemini/where-to-use-nano-banana-pro/)

---

## Q9. Performance-measurement metrics (beyond tenant financial performance)

### Question (restated)
SOTA real-estate KPIs beyond "did the tenant pay". Which should BORJIE ship out of the box?

### Answer
The consensus KPI set across 2026 industry sources (Pacific ABS, Revela, KPI Depot, BOOSTNOI, Cove) converges on roughly 12–14 metrics, grouped into four families.

**Financial (asset performance):**
- **Net Operating Income (NOI)** — rental income minus operating expenses. The anchor metric.
- **Cap Rate** — NOI / property value. Portfolio-comparable return measure.
- **Cash-on-Cash Return** — annual cash flow / equity invested.
- **Operating Expense Ratio (OER)** — operating expenses / effective gross income. >40% is a warning.
- **Revenue per Sqm / per Unit** — normalises across asset classes.

**Leasing / demand:**
- **Occupancy Rate** — occupied / total units. TZ residential benchmark 90–95%; commercial 85–90%.
- **Economic Occupancy** — rent collected / rent billed at 100% occupancy. Catches both vacancy and delinquency.
- **Time-to-Lease** — days unit is vacant.
- **Turnover Rate / Renewal Rate** — churn; 50–60% renewal is industry typical for multifamily.

**Resident / tenant quality:**
- **Tenant NPS** — the single best qualitative indicator, via quarterly pulse.
- **Maintenance Response Time** — median hours from request to resolution.
- **Dispute / Incident Rate** — complaints per 100 units per month.

**Asset health:**
- **Maintenance Cost per Sqm** — rising values = deferred-maintenance debt catching up.
- **Asset Appreciation / Valuation Delta** — year-over-year.

Revenue per sqm and OER are flagged as increasingly critical in 2026 because of cost inflation on utilities, insurance and labour.

### Recommendation for BORJIE
Ship these 13 out of the box on every landlord's dashboard, grouped by family:

**Tier 1 (must-have at MVP):** NOI, Occupancy Rate, Economic Occupancy, Collection Rate, Time-to-Lease, Maintenance Response Time.

**Tier 2 (ship in v1.1):** Cap Rate, OER, Revenue per Sqm, Renewal Rate, Tenant NPS, Dispute Rate, Maintenance Cost per Sqm.

Design guidance:
- Every KPI must be drill-downable to the underlying events (ledger, lease, ticket). Opaque numbers lose trust.
- Default comparisons: MoM, YoY, vs. portfolio average, vs. asset-class benchmark (load public benchmarks where available; start with NMHC / JLL figures).
- Alert thresholds are org-configurable but shipped with sensible defaults (e.g. OER > 50%, Occupancy < 85%).
- For TZS portfolios, also display currency-normalised USD for investor-friendliness.

### Sources
- [14 Essential KPIs Property Managers Must Track in 2026 — Pacifica](https://www.pacificabs.com/knowledge-center/blog/14-essential-kpis-property-managers-must-track-this-year/)
- [12 Most Important Real Estate KPIs (2026) — KPI Depot](https://kpidepot.com/benchmarks/real-estate-kpi-benchmarks-207)
- [Top 12 Property Management KPIs for 2026 — Revela](https://www.revela.co/resources/property-management-kpis)
- [KPIs every real-estate owner should track — BOOSTNOI](https://boostnoi.com/blog/benchmarking-success-kpis-every-real-estate-owner-should-track)
- [What are the KPIs in Property Management — Cove](https://cove.is/blog-press/what-are-the-kpis-in-property-management-key-metrics-you-should-track)

---

## Q10. Report catalog — SOTA reports to ship out-of-the-box

### Question (restated)
What reports do Yardi / MRI / AppFolio / Buildium ship by default? At what cadence? Which are legally required in Tanzania?

### Answer
The industry-standard catalogue (seen across DoorLoop's 60+ template list, AppFolio's owner/CAM/delinquency reports, Buildium's delinquent-tenant report, Yardi Voyager's forecasting+consolidation suite) breaks down as follows:

**Daily / on-demand (operational):**
- Rent Roll (point-in-time snapshot)
- Delinquency Report (who owes what, days late)
- Work-Order Status Report
- Vacancy Report
- Cash Receipts Journal

**Weekly:**
- Leasing Activity Report (tours, applications, signed leases)
- Collections Summary
- Move-in / Move-out pipeline
- Maintenance SLA Report

**Monthly (primary owner-facing package):**
- Owner Statement (income, expenses, net disbursement)
- Income & Expense Statement (P&L)
- Rent Roll (as-of last day)
- Occupancy Report
- General Ledger
- Bank Reconciliation
- Accounts Payable aging
- Trust Account Reconciliation (where required by regulator)
- Tax withholding / remittance summary

**Quarterly:**
- Portfolio Performance Dashboard (NOI, Cap Rate, OER trends)
- Cap-Ex Forecast vs. Actual
- Tenant NPS Summary
- Lease-Expiry Schedule (next 12 months)

**Semi-annual / Annual:**
- Budget vs. Actual (variance analysis)
- 1099 / tax reporting package (US) — TZ equivalent: TRA withholding summary
- Annual Financial Statements (GAAP / IFRS)
- Property Valuation Update
- Insurance Renewal Summary
- CAM Reconciliation (commercial)

**Tanzania-specific legal/regulatory reports:**
- **Monthly** — VAT return (if registered, due 20th of following month).
- **Monthly** — WHT (withholding tax) on rent, remitted to TRA.
- **Quarterly** — Provisional income-tax instalments (31 Mar, 30 Jun, 30 Sep, 31 Dec).
- **Annual** — Return of Income (individuals/companies, due 30 Jun).
- **Annual** — Property tax filing with municipal/city council.
- **Audit-ready trial balance** — should be kept permanently available for TRA audit.

### Recommendation for BORJIE
Ship a **tiered report catalogue** in v1, roughly 25 templates, all export-to-PDF/Excel:

**Daily / on-demand (ship 5):** Rent Roll, Delinquency, Work-Order Status, Vacancy, Cash Receipts.

**Weekly (ship 4):** Leasing Activity, Collections Summary, Move-in/out Pipeline, Maintenance SLA.

**Monthly (ship 8, TZ-tuned):** Owner Statement, P&L, Rent Roll, Occupancy, GL, Bank Rec, **TRA WHT Remittance**, **VAT Return prep (where applicable)**.

**Quarterly (ship 4):** Portfolio Performance (NOI/Cap Rate/OER), Lease-Expiry 12-mo, Tenant NPS, **TRA Provisional Tax prep**.

**Annual (ship 4):** Budget vs. Actual, **Return of Income prep**, Property Tax filing summary, Property Valuation Update.

Design principles:
- Every report is parameterised (date range, property, portfolio, accounting method).
- Every report links back to source documents (invoice, payment, ticket) — not just totals.
- TZ-regulatory reports **pre-fill the TRA form layout** so landlords can submit without retyping; this is a high-stickiness feature competitors won't match.
- Owner statements must be sendable over WhatsApp as a PDF + summary message — match the local communication reality.
- Versioned audit trail per report run (who generated, when, with which params) to support TRA audit defence.

### Sources
- [Property Management Reports: What's Included — DoorLoop](https://www.doorloop.com/blog/property-management-report)
- [AppFolio / Yardi / Buildium report comparison — CapActix](https://www.capactix.com/real-estate-accounting-challenges-appfolio-buildium-yardi/)
- [Buildium Delinquent Tenants Report](https://help.buildium.com/hc/s/article/Delinquent-tenants-report-1557494407478)
- [Tanzania TRA — Tax and Duties at a Glance 2024-2025](https://www.tra.go.tz/images/uploads/forms/TAX_AND_DUTIES_AT_A_GLANCE_2024-2025.pdf)
- [VAT in Tanzania Guide — TanzaniaInvest](https://www.tanzaniainvest.com/vat)

---

## Summary of cross-cutting recommendations

1. **Build for the Tanzanian legal layer first, globally-compatible second.** Ward Tribunals, Rent Restriction Act caps, TRA monthly WHT, VAT 18%, Property tax 0.15/0.20% — all hard-codable and all sources of competitive moat.
2. **AI everywhere as assistive, autonomous only inside explicit policy sandboxes.** Negotiation, damage scoring, clause drafting, risk scoring — draft, never decide.
3. **Evidence-first data model.** Every KPI, risk flag and deduction is drill-downable to source events (ledger line, photo hash, inspection record). This wins audits and tribunal cases.
4. **WhatsApp is the primary channel, not a secondary one.** Surveys, pulse-NPS, owner statements, payment reminders, negotiation messages — design for 80% WhatsApp, 20% email/web.
5. **Correct the voice-memo on Nano Banana.** Template-first doc system; reserve Nano Banana for marketing imagery, not contracts.
6. **Start with payment via PSP, graduate to direct GePG.** Time-to-market matters more than margin in v1.
7. **Ship 13 KPIs + 25 reports in v1.** This is the minimum to be taken seriously by commercial landlords alongside incumbents.

---

## SOTA Maintenance Patterns (Wave 8 research)

**Predictive vs. reactive.** The existing FAR pipeline (`asset_components` + `far_assignments` + `condition_check_events`) is a reactive, cadence-driven monitoring loop: a trigger fires when a check becomes overdue, a notification fans out to the three-party recipient set, and an event is logged. That model is sound for regulatory evidence (customer-research S7/S13 "conditional survey of assets"), but it is structurally blind to components that are *degrading between cadences*. State-of-the-art property platforms — and heavy-asset operators like airlines and utilities — layer a **predictive** tier on top of the reactive one. The predictive tier consumes the same condition / age / inspection-gap state but projects risk forward and ranks components by a composite priority score, rather than waiting for a calendar event. BORJIE's Wave 8 `predictive-scheduler` module is this layer: it never writes to the DB, never mutates its inputs, and produces auditable, deterministic outputs that can be explained to a regulator auditor line by line.

**Component half-lives and the 50% rule.** Institutional property-management playbooks (ASHRAE Service Life Handbook, BOMA asset-class tables, IFMA benchmarks) converge on the following expected lifespans per category: **HVAC ~15 years, roofing ~20 years, plumbing ~40 years, electrical ~30 years, structural ~50 years**. These are the defaults we hard-code in `DEFAULT_LIFESPAN_MONTHS` so that components with missing `expectedLifespanMonths` still score sanely. On top of lifespan, the industry-standard repair-vs-replace heuristic is the **"50% rule"**: when cumulative repair spend exceeds 50% of replacement cost *and* the asset is past 50% of its expected life, replace rather than repair — the marginal cost of continued repair is dominated by the opportunity cost of a fresh asset's full life and warranty. Our `recommendReplacements` encodes exactly this: age-ratio >= 0.5 AND repair-ratio >= 0.5 OR condition='critical' -> replace; excellent + young -> defer; otherwise -> repair at ~25% of replacement cost. The budget is consumed greedily by cost-benefit ratio (priority score per shilling), which matches how real asset-management teams triage capex queues.

**How the scheduler embodies these patterns.** The scoring function weights condition (40%), age-to-lifespan ratio (25%), inspection gap vs. category cadence (15%), criticality (10%), and a seasonal boost (10%) tuned to the Tanzanian climate — dry-season (Jun-Oct) stresses HVAC/mechanical, wet-season (Mar-May, Nov) stresses roofing/structural/electrical. The degradation forecast is a linear decay model with a 1.5x accelerator past half-life (real-world bathtub-curve approximation), never exceeding the critical ceiling. Every output object carries the input's `tenantId`, the functions are referentially transparent (same input -> same output, verified by `JSON.stringify` equality tests), and nothing reaches for an LLM — which is the correct posture for capex decisions that must be defended in a Ward Tribunal or TRA audit. This predictive layer turns the evidence-first FAR foundation into a forward-looking capital-planning tool without compromising the auditability that makes the platform defensible.
