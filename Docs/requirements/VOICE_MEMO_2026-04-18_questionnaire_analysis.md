# Voice Memo — Questionnaire Analysis & Architectural Directives

> **Disclaimer — BORJIE product neutrality**
>
> This document preserves the original 2026-04-18 research interview with a
> specific large public-sector estate client (the "research client") verbatim.
> It is retained as the source-of-truth record of the customer-discovery
> process that shaped the elastic-architecture directives below.
>
> **The research client's identity is NOT referenced anywhere in the
> BORJIE product.** BORJIE is built for every estate company in the
> world, not any single customer. In code, migrations, seeds, marketing
> copy, AI prompts, and customer-facing docs we use generic phrasing such
> as "a multi-district public-sector estate" and a neutral seed fixture
> called "Demo Estate Corporation" (`demo-*` IDs). The historical references
> to "TRC" / "Tanzania Railway Commission" below describe the original
> interview subject only; they do NOT imply any productized dependency on,
> endorsement by, or commercial relationship with that organization.

**Date:** 2026-04-18
**Source:** Founder voice memo, transcribed verbatim
**Context:** Analysis of the "ESTATE Native AI Operating System Questionnaire" administered to a large multi-district public-sector estate client (originally captured as "Tanzania Railway Commission / TRC" in the verbatim transcript) and similar large asset-owning organizations (National Housing Commission, banks, etc.). This memo translates their answers into elastic-architecture design directives for BORJIE101. See the disclaimer above — specific client names preserved here are historical only and do NOT appear anywhere in the BORJIE product itself.
**Relationship to existing docs:** This is the **source-of-truth directive** that supersedes / amplifies prior drafts. When `BORJIE_PRD.md`, `BORJIE_SPEC.md`, `DOMAIN_MODEL.md`, `ARCHITECTURE_BRAIN.md` disagree with this memo, this memo wins — unless the existing code already implements the intent of this memo, in which case we **amplify, not replace**.

---

## Guiding principles stated by founder

1. **Amplify existing code — do not delete core logic without a replacement or amplification.**
2. **Elastic architecture everywhere** — never force a fixed framework on the tenant-organization; let them configure their own hierarchy, roles, regions, property classes, approval thresholds.
3. **Intelligent by default** — AI is the companion for every persona (tenant, vendor, estate manager, owner). No static boring reports — interactive reports with action plans.
4. **Owner-of-their-own-assets model** — unlike Airbnb, the platform is for organizations that **own and internally manage** their assets. Third-party managers only enter through the organization's own permission flow.
5. **State-of-the-art only** — Harvard-PhD-grade estate-management reasoning as the first line of advisory to owners.

---

## Section 1 — Roles, permissions, approval flow

### Centralized role hierarchy (elastic, not fixed)
- **Owner** — full control; **only the Owner can delete the account.**
- **Super Admin** — ≤2 per org (cap negotiable later); same powers as Owner **except cannot delete the account.**
- **Admin (levels 1–4)** — decreasing power/control top-down. No hard cap yet.
- **Estate Manager**
- **Station Master** — treat as a **tagged worker role** (workers can carry tags; a tag like "Station Master" or "Surveyor" carries metadata about the bracket of work).
- **Other Workers with Title** — tag-driven; teams under same tag share permissions/workflows.

> **EMU mapping for TRC:** The Estate Management Unit is modeled as the Owner (even though legally the Railway is the owner). When we centralize roles, the EMU *is* the Owner account.

### Approval flow (directive → customer request for leasing)
Conditional routing, configurable per org:

```
IF asset_type == bareland AND monthly_rent >= threshold:
    route → Directorate of Civil Engineering & Infrastructure (internal check)
    THEN route → Director General (approval)
ELIF asset_type == developed (warehouse, building, etc.) AND monthly_rent >= threshold:
    route → Director General (direct approval)
ELIF monthly_rent < threshold (e.g. 500,000 TZS):
    route → Department-level only (EMU, no DG involvement)
```

- `threshold` is **configurable per org** (TRC's is 500K TZS/month; another org will set a different number).
- The agent must **automatically pick up the scenario** and route accordingly.
- Customer application → generated letters → routed through flow → returned to customer.
- Works for TRC, NHC, banks — same primitive: **conditional approval-chain engine with configurable thresholds and asset-type branches.**

### Station-office-initiated workflow
- Regional offices exist but **all estate issues initiate at station offices.**
- Application should route to the **nearest station master / designated individual** based on proximity to the target asset location.
- Owners/admins decide which station masters (or designated people) are responsible for which geographic clusters of assets.

### Delay elimination
Application delays are a known pain. Architecture must demonstrably solve delays via:
- Automated routing (no manual forwarding)
- SLA timers + reminders at every stage
- Auto-escalation when SLA breached

---

## Section 2 — Property classification (elastic taxonomy + geo-registry)

### Property classes
- Commercial / Mixed-use / Villas / Hotels / Plots / Warehouses / etc.
- **Deep research needed** on official professional classification schemes.
- Each class has sub-attributes: rooms, kitchens, bathrooms, furnishing level, appliances, fixtures, size, etc.
- Owners select which attributes apply to their portfolio; the platform exposes the *full superset*.

### Infinite property addition + full particulars
- No cap on number of properties.
- Each property carries ALL details the owner chooses to track.
- Tenants can see the "Airbnb-for-internal-portfolios" view of an owner's assets: photos, videos, specs, map location, zoom-to-street.

### Elastic geo-hierarchy (CRITICAL)
- **Do NOT force a fixed region → district → village structure.**
- TRC's convention: **Districts contain Regions** (counter-intuitive to global convention).
- Platform must allow:
  - Org-defined hierarchy labels (District/Region/Village/Zone/Ward/Street/…)
  - Parent-child-grandchild-great-grandchild nesting (N-deep)
  - Geofencing via **Google Maps API** — each node colored/outlined on map
  - Street-level pin for each asset
  - Interactive map view of all assets and all hierarchy levels

### Intelligent data migration (fixed-asset register → platform)
- Accept CSV, Excel, PDF, scans, whatever legacy format the org has.
- Perform deep document analysis → automated data capture → autofill → one-click confirmation by the admin.
- **Never make them retype data they already have.**

### Condition monitoring (fixed asset register assignment → automated trigger)
- Current pain: manual annual audits, often skipped.
- New flow: any authorized person can **trigger a fixed-asset-register assignment** → system notifies estate managers, technicians, **and the tenant** → tenant provides live feedback on unit condition → officer reviews, confirms evidence (photos/videos), attaches → AI generates the conditional survey report automatically.
- Turn the annual chore into an on-demand, evidence-driven workflow.

### Leasing flexibility
- Lease granularity is owner-controlled: a whole plot, a building, a single room, a section of a floor.
- Asset categorization must support **arbitrary subdivision**; each subdivided part has its own history, tenant, documents.
- History nests infinitely: building → unit → customer → contract → payments → documents → maintenance events.

---

## Section 3 — Asset registry, documents, audit trail

### Core pain points (TRC)
- Incomplete/outdated records cause **revenue loss** and **double-leasing conflicts** (same asset leased to two customers).
- No direct link between asset record and Google Maps, physical description, documents.
- Land disputes, unpaid rent, unauthorized usage, unclear agreements.
- **Poor pricing negotiations** — high-value assets routinely under-leased.

### Architectural requirement: infinite portals / nested history
- Click asset → see full history, tenants, contracts, payments, documents, maintenance events.
- Click tenant → see their full history across **all** assets they've held.
- Click document → see asset + tenant + contract it's tied to.
- Every entity is a portal into every other related entity.

### Audit trail
- Clear chain from price negotiation → leasing → onboarding → post-lease activities → renewal/exit.
- Every decision has a traceable actor + timestamp + rationale.

### Surveyor support
- If "Surveyor" is a worker tag, the Estate Manager app adapts: surveyor sees map-centric tools to set coordinates, field-capture asset boundaries.
- AI adapts persona guidance based on worker tag.

### Parcel subdivision
- First-class feature, not an afterthought. Legal subdivision events create child asset records with their own lifecycle while preserving parent lineage.

### Usage monitoring post-lease
- Current tools: annual audits + revenue collection trends.
- Additional vectors to add (deep research): tenant feedback loops, IoT sensors (if available), satellite imagery for land-use verification, scheduled drone/site visits, automated compliance checks.

---

## Section 4 — Customer journey

### Tenant app is **universal, not org-siloed**
- One download, access many organizations.
- Tenant can hold simultaneous tenancies across multiple orgs.
- To join TRC's portfolio, tenant receives/enters a **special code** from TRC.

### Intake flow
- Customer app → select org → see opportunities OR request unique opportunity.
- AI helps tenant **frame the application letter** — compelling case, correct structure, professional tone.
- Submit → routes to the correct station master / designated individual by proximity.

### Marketplace inside tenant app
- Plots, buildings, units, **and tenders** (maintenance work packages).
- AI can talk to prospective tenants, describe a unit, **negotiate price** within owner-defined ranges.
- Referrals supported.

### Profile-driven applications
- Tenant builds rich profile once → share with any owner on application.
- Owners can **request financial statements + litigation history** as part of application → tenant uploads on phone → AI analyzes → owner sees tenant risk report on their dashboard.

### Automated follow-ups
- Owners/designated people can schedule automated follow-up workflows — AI handles the cadence.

---

## Section 5 — Communication channels

- Chat, in-app messaging, automated phone calls, AI-driven price negotiation with tenants.
- Problem reporting via app (maintenance, disputes, price negotiations, anything).
- Announcement/plan updates — AI-generated; **use Nanobanana** for document and package creation. State-of-the-art only.
- **Full audit trail** of all conversations and transactions — always-on.
- Owners request financial statements & litigation history as part of tenant profile; deep analysis auto-generates standing report.

---

## Section 6 — Payments & financial

### Tanzania-specific
- **GePG (JEPG) control number** is the government payment rail — must integrate. Deep research: API, onboarding, reconciliation hooks.

### Reconciliation challenges
- Current system shows debts in two different figures (data drift).
- Our system must **catch discrepancies automatically** when orgs migrate in — cross-check customer histories against payment records, flag mismatches.

### Areas (arrears) tracking
- Owners currently do manual Excel calculations because the existing system is buggy.
- We provide Excel-like interactive calculation + automatic arrears ledger per tenant.
- Deep research: SOTA rent-ledger / arrears handling in real estate.

### Payment flexibility
- Installment requests + deadline-extension requests as first-class flows.
- No fixed qualification methodology today → **we build the methodology** (Harvard-PhD-grade credit-scoring lens):
  - Past payment streak, contract history, occupancy duration, maintenance-dispute frequency, financial-statement analysis, litigation history, asset-type profitability, macro indicators.
  - Risk-tiered recommendations the owner can accept/override.

### Reports (daily, weekly, monthly, quarterly, semi, annual)
- Revenue, customer status (occupied / not), valid vs expired contracts.
- **One-click generation.** Full snapshot at any moment.
- Deep research: what reports do SOTA real-estate platforms produce? Cover the gaps.

---

## Section 7 — Maintenance

### Current TRC flow (pain)
- Customer raises issue → joint cost assessment → if no budget, tenant pays and deducts from future rent (per written agreement).
- Manual, slow, error-prone.

### New flow (automated, AI-mediated)
1. Tenant opens maintenance ticket in app → AI guides evidence capture (photos, videos, what-to-include).
2. AI structures the case, notifies owner/estate manager.
3. AI mediates cost-assessment conversation (tenant ↔ org).
4. AI drafts the compensation agreement, both sides agree in-app.
5. System auto-calculates rent deduction, records it on tenant ledger, surfaces it on next invoice.

### Tender workflow
- When org prefers org-side tendering: tender is published to the marketplace (visible in Estate Manager app and/or technician-facing surface).
- Technicians/vendors see tenders → bid/accept → AI guides them through reporting.
- Interactive reports (click video in middle of scrolling report) for completion evidence.

### Inventory / appliance tracking
- Track appliances installed/changed/removed over time per unit.
- Warehouse inventory: what's functioning, broken, in-transit, new.

### Repeated-problem taxonomy
- Curated catalog of common issues ("wear and tear", categorized by asset/room/component) — improves data quality and analytics.

---

## Section 8 — Contracts & documents

### Scanning & upload
- Built-in scanner (camera → scan mode): bundles, individuals, multi-format.
- Auto-annotation, format conversion.
- Each document is linked to an asset OR a customer OR both.

### Document intelligence
- **Chat with any document** and chat with **groups of documents.**
- AI acts as Harvard-level estate manager: pulls relevant docs on demand, summarizes, cross-references.
- Integrations with government document-verification systems (e.g., Umbrella for Tanzania) kept **open** — manual approval supported until integrations land.
- Expiry-aware: AI knows which docs expire, reminds designated person, auto-retrieves updated copies, shows old vs new side-by-side on customer/building history.

### Retrieval
- Current state: trips to registry office, hard to retrieve quickly. We become the repository.

### Audit & reconciliation queries
- Surface inconsistencies as **flagged insights** on the dashboard.
- When a new org migrates in (docs + customer histories uploaded), AI auto-creates customer profiles, wires links to assets, surfaces any gaps.

---

## Section 9 — Renewals & end of relationship

### Contract-end automation
- Insights + alerts + reminders fire on both owner and tenant side as contracts near expiry.
- Tenant writes renewal letter in clicks (AI-generated from profile).
- Owner decides, AI executes.

### Bad-history flags (deep research needed)
- What counts as "bad history" that should trigger non-renewal review?
  - Late rent streaks, misuse of asset, subleasing without permission, maintenance-damage history, dispute frequency, etc.
- Auto-flag when thresholds crossed.

### Leave flow
- Re-advertise vacated asset.
- **Reach out to previous interested parties** (waitlist) automatically when asset becomes available.
- Joint move-out inspection (unless org allows tenant self-checkout).
- Handle damage-deduction disagreements with evidence + negotiation trail.

---

## Section 10 — Disputes & compliance

### Top disputes
- Late rent (most common).
- Unauthorized subleasing.

### Workflow additions
- Rent-payment reminders calibrated by policy.
- AI explains policy consequences to tenant proactively, before issues escalate.
- Notice-giving workflows with configurable grace periods.
- Evidence bundling (payment records, correspondence) auto-extracted on demand for dispute resolution.

### Sublease permission
- Tenant can request sublease → if approved, add subtenant to tenant group → clarify rent responsibility → audit trail.

### Compliance reminders
- Pre-deadline reminders with action plans, not just warnings.

---

## Section 11 — Official letters & customer requests

### Letter types
- Residency proof, tenancy confirmation, payment confirmation, reference letters.
- **Any letter on demand** — AI-generated, templated, owner-approved.

### Approval workflow
- Head of department/unit approves and delegates to a worker.
- Automated to start with; human override supported.

---

## Section 12 — Financial risk & credit behavior

### Extension requests (30 days pre-expiry)
- Reminders + extension request flows.
- Carrot-and-stick: rewards for early payment, consequences for late.
- Owner toggles: auto vs human-controlled.

### Payment-history as credit signal
- Formal proof-of-payment history → tenant uses it to apply for financing elsewhere.
- Owner uses it to grade reliability and set flexibility terms.

### Risk: relaxed tenants abusing flexibility
- Explicit lever: owner can switch a tenant from flexible to strict mode based on behavior.

---

## Section 13 — Reporting & decision-making

### Senior-leader most-requested: leasing financial performance
- Top of dashboard, always.

### Hardest report today: conditional survey of assets
- We kill this pain point — see Section 7. Evidence-driven, AI-assembled, comparative to prior surveys, **with action plans**.

### Hard decisions: maintenance
- Data scattered across sites. Centralize + AI-synthesize.

### Performance measurement vectors (deep research)
- Beyond tenant financial performance: occupancy rate, churn, maintenance cost per asset, revenue per sqm, time-to-lease, dispute count, NPS, asset appreciation, etc.

---

## Section 14 — Technology & operational challenges

### Legacy integration
- Many orgs use **LPMS (Land and Property Management System)** or similar.
- Integrate for data pull **and** offer smooth migration: AI-guided ingest of documents, auto-mapping, auto-population.

### Current manual work
- Application writing, all correspondence — all manual today. We automate all of it.

### "Areas" calculation discrepancies
- Biggest operational stressor. Root-cause: data drift + manual Excel.
- Our platform: canonical ledger + interactive verification + audit trail.

### Tenant registration time
- Current: slow. New: AI-driven intake + profile reuse → minutes, not hours.

---

## Section 15 — Future vision (TRC stated)

- "Improved system → restored revenue."
- Eliminate lack of conditional survey reports → better maintenance plans.
- Integrated system + stakeholder awareness.
- Ease of communication with customers.

---

## Cross-cutting directives (extracted)

1. **Configurable thresholds + conditional workflows everywhere.** (Approval routing, maintenance compensation, renewal rules, payment flexibility.)
2. **Every entity is a portal into every related entity.** (Click anywhere → drill into full context.)
3. **AI is the persona-adaptive companion.** (Owner advisor / Estate Manager assistant / Vendor guide / Tenant negotiator — same brain, different hat.)
4. **Document-chat + document-group-chat** as a core surface.
5. **Google Maps geofencing** at every hierarchy level, colored nested regions, street-level asset pins.
6. **Marketplace is intelligent + negotiating**, not a static catalog.
7. **Carrot-and-stick gamification** for rent behavior (deep research needed on state-of-the-art approaches).
8. **Interactive reports with action plans**, not static PDFs.
9. **Infinite subdivision** of assets (building → floor → room → bed if needed).
10. **Universal tenant identity** across organizations.
11. **First-line advisory role** — platform explains *what's eating money, what's going well, where to expand, refinancing strategy*.

---

## Open research questions (parked here, to be answered in follow-on research report)

1. Professional property-class taxonomy (global + East African variants).
2. GePG API integration details + Tanzanian real-estate compliance (Land Act, Rent Restriction Act, LPMS schema).
3. State-of-the-art rent-collection gamification (point systems, early-pay discounts, streak-based credit score).
4. AI-mediated price-negotiation patterns used by SOTA proptech.
5. Post-lease usage-monitoring vectors beyond annual audits.
6. Move-out damage-assessment workflows (evidence + dispute handling).
7. Bad-history thresholds for non-renewal triggers (legally defensible, jurisdiction-aware).
8. Nanobanana document generation — confirm capability and integration path.
9. Performance-measurement metrics (beyond tenant financial performance).
10. Report catalog — SOTA real-estate reports we should ship out-of-the-box.

---

## Non-negotiables

- **Do not delete core logic without a replacement or amplification.**
- **Build upon what we have or change for the better.**
- **Elastic architecture — never force a framework.**
- **State-of-the-art only.**
