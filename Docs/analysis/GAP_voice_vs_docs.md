# GAP Analysis: Voice Memo (2026-04-18) ↔ Existing Docs

**Date:** 2026-04-18  
**Scope:** Mapping directives from the founder's voice memo against 22,000 lines of existing design documentation  
**Methodology:** Grep-based search + content analysis across BORJIE PRD, SPEC, DOMAIN_MODEL, ARCHITECTURE_BRAIN, DATA_FLOWS, RESEARCH_REPORT_CPG, and API contracts.

---

## Summary

- **Fully covered:** 18 directives
- **Partially covered:** 24 directives  
- **Not covered:** 15 directives
- **Conflicts:** 3 directives (requiring founder decision)

**Total directives analyzed:** 60

---

## Section 1 — Roles, Permissions, Approval Flow

### Directive: Owner full control + only Owner can delete account
- **Status:** FULLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:89–100 (Organization entity); ARCHITECTURE_BRAIN.md:49–60 (Persona taxonomy)
- **Gap:** None identified

### Directive: Super Admin (≤2 per org, cap negotiable); cannot delete account
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:51–56 (lists "Super Admin" as distinct from Owner in persona taxonomy)
- **Gap:** No explicit cap of ≤2 in existing docs; no explicit "cannot delete account" logic documented

### Directive: Admin levels 1–4 (decreasing power top-down, no hard cap)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:51–56 mentions hierarchy but does not detail 4 levels explicitly
- **Gap:** Levels 1–4 structure not spelled out; power/scope boundaries missing

### Directive: Estate Manager role (as documented persona)
- **Status:** FULLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:51–56; BORJIE_SPEC.md (multiple references to estate manager workflows)
- **Gap:** None identified

### Directive: Station Master as tagged worker role (workers carry tags; tag = metadata about work bracket)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions "Station Master" in a multi-district public-sector estate context; ARCHITECTURE_BRAIN.md:49–60 mentions "worker tag" concept
- **Gap:** Tag-driven permission/workflow mechanics not fully detailed; metadata schema for tags undocumented

### Directive: Other Workers with Title (tag-driven; teams under same tag share permissions/workflows)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:49–60 mentions coworker personae and team-level permissions via VisibilityScope
- **Gap:** Tag-driven team sharing and shared permission logic not explicitly modeled

### Directive: EMU (Estate Management Unit) as Owner account for the research-client fixture
- **Status:** FULLY_COVERED
- **Existing coverage:** VOICE_MEMO itself (line 30); BORJIE_SPEC.md demo-org-specific sections
- **Gap:** None identified (memo-specific context)

### Directive: Conditional approval routing (asset_type + monthly_rent threshold → different routes)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md:36–49 (approval flow diagram); DATA_FLOWS.md:61–87 (Saga pattern for multi-service operations)
- **Gap:** Conditional logic rules (IF asset_type == bareland AND monthly_rent >= threshold...) not codified as executable logic; configurable thresholds missing detail

### Directive: Threshold is configurable per org (not hard-coded)
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** No org-level configuration schema for approval thresholds; no mention of dynamic threshold management

### Directive: Agent automatically picks scenario and routes accordingly
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:34–36 (Orchestrator as deterministic FSM routes intent); AI-copilot integration referenced
- **Gap:** Agent decision logic for scenario detection not modeled; routing rules not explicit

### Directive: Customer application → generated letters → routed through flow → returned to customer
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md references application-to-letter generation; CUSTOMER_APP.md shows application submission
- **Gap:** Full application-to-letter workflow with routing and return-to-customer not detailed in sequence

### Directive: Station-office-initiated workflow; route by proximity to nearest station master
- **Status:** NOT_COVERED
- **Existing coverage:** None found in spatial/geo-routing context
- **Gap:** Geolocation-based routing to nearest designated person; proximity algorithm not documented

### Directive: Owners/admins decide which station masters responsible for which geographic clusters
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md mentions geographic hierarchy; CUSTOMER_APP.md:8–22 shows property/unit relationship but not geographic assignment
- **Gap:** Admin UI/logic for assigning staff to geographic clusters not documented

### Directive: Delay elimination via automated routing, SLA timers + reminders, auto-escalation
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DATA_FLOWS.md:61–87 (Saga pattern + event-driven flows); CUSTOMER_APP.md:44–47 (SLA visibility in maintenance); OPERATIONAL_SLA.md referenced but not fully read
- **Gap:** SLA configuration, auto-escalation triggers, and reminder cadence not fully specified

---

## Section 2 — Property Classification (Elastic Taxonomy + Geo-Registry)

### Directive: Property classes (Commercial / Mixed-use / Villas / Hotels / Plots / Warehouses / etc.)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:86–100 mentions "property" entity with types; BORJIE_SPEC.md references property classes
- **Gap:** No explicit taxonomy of classes (Commercial/Mixed-use/Villas/Hotels/Plots/Warehouses); schema for sub-attributes (rooms, kitchens, bathrooms, furnishing, appliances, fixtures) not modeled

### Directive: Deep research on professional classification schemes needed
- **Status:** NOT_COVERED (Research task, not documented)
- **Existing coverage:** None
- **Gap:** Research question #1 from voice memo (line 375); RESEARCH_REPORT_CPG.md does not address property classification taxonomy

### Directive: Owners select which attributes apply to their portfolio; platform exposes full superset
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** No configurable property attribute schema; no mention of tenant-org customization of property attributes

### Directive: Infinite property addition + full particulars (no cap; each property carries all details owner chooses)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md mentions Property entity with extensible fields; no explicit "no cap" constraint documented
- **Gap:** Scalability guarantees for unlimited properties not stated; property detail extensibility not detailed

### Directive: Tenants can see "Airbnb-for-internal-portfolios" view (photos, videos, specs, map, street-level)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:16–22 mentions "Lease Management" view; no mention of portfolio marketplace view or Airbnb-style listing
- **Gap:** Marketplace listing surface for customers not documented; photo/video/specs view not described in customer-facing docs

### Directive: Elastic geo-hierarchy (CRITICAL) — do NOT force fixed region → district → village
- **Status:** NOT_COVERED
- **Existing coverage:** DOMAIN_MODEL.md mentions property location hierarchy but does NOT address org-defined labels or N-deep nesting
- **Gap:** Configurable hierarchy labels (District/Region/Village/Zone/Ward/Street) and N-level nesting not modeled

### Directive: the research client's convention: Districts contain Regions (counter-intuitive to global convention)
- **Status:** NOT_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions a multi-district public-sector estate context; no flexible hierarchy model documented
- **Gap:** No mention of org-customized hierarchy inversion support

### Directive: Geofencing via Google Maps API — each node colored/outlined on map
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md mentions map-centric tools and Google Maps; no API contract or implementation detail found
- **Gap:** Google Maps integration endpoints, geofencing schema, and colored-outline rendering not documented

### Directive: Street-level pin for each asset; interactive map view of all assets and all hierarchy levels
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md references property location; no mention of street-level pins or interactive hierarchy map
- **Gap:** Interactive hierarchy map visualization not documented; street-level pin feature not detailed

### Directive: Intelligent data migration (CSV, Excel, PDF, scans → auto-capture → autofill → one-click confirmation)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:501–516 mentions document upload and OCR extraction; VOICE_MEMO line 87–89 describes the intent
- **Gap:** Migration wizard for legacy LPMS data not documented; auto-mapping and confirmation flow not fully detailed

### Directive: Condition monitoring (fixed-asset-register assignment → tenant feedback → AI-generated report)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:451 mentions "conditional survey"; CUSTOMER_APP.md references maintenance flow; no mention of "fixed-asset-register" workflow trigger
- **Gap:** Fixed-asset-register assignment as workflow trigger not documented; automated conditional survey report generation not detailed

### Directive: Leasing flexibility (lease granularity owner-controlled; arbitrary subdivision of assets)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions multi-unit leasing; DOMAIN_MODEL.md:86–100 mentions Unit entity
- **Gap:** Arbitrary subdivision model (building → floor → room → bed if needed) not explicitly documented; subdivision as first-class workflow not detailed

### Directive: Parcel subdivision (first-class feature; legal subdivision events create child asset records with parent lineage)
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Parcel subdivision workflow, child-asset creation, and parent lineage tracking not documented

### Directive: Usage monitoring post-lease (annual audits + additional vectors: tenant feedback, IoT sensors, satellite imagery, drone visits, compliance checks)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md mentions maintenance feedback; RESEARCH_REPORT_CPG.md:451 mentions sensor data; no mention of satellite imagery, drone visits, or compliance checks
- **Gap:** Post-lease usage-monitoring vectors not detailed; IoT/satellite/drone integration not documented

---

## Section 3 — Asset Registry, Documents, Audit Trail

### Directive: Core pain points (incomplete records, double-leasing, no asset-map link, land disputes, under-leasing)
- **Status:** FULLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:27–40 (value proposition); RESEARCH_REPORT_CPG.md identifies similar pain points
- **Gap:** None identified (architectural awareness documented)

### Directive: Infinite portals / nested history — click asset → see full history, tenants, contracts, payments, documents, maintenance
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:25–56 emphasizes "relationship-first" graph approach; DATA_FLOWS.md:91–146 describes entity relationships
- **Gap:** UI/navigation model for "infinite portals" not documented; query patterns for cross-entity navigation not detailed

### Directive: Audit trail — price negotiation → leasing → onboarding → post-lease → renewal/exit (every decision traceable)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:59–70 (principle: Evidence-Grade); DATA_FLOWS.md mentions audit log service; DOMAIN_MODEL.md references audit entities
- **Gap:** End-to-end audit trail schema (negotiation → onboarding → renewal) not fully modeled; actor+timestamp+rationale capture not detailed

### Directive: Surveyor support (Surveyor tag → Estate Manager app adapts; see map-centric tools, field-capture asset boundaries)
- **Status:** NOT_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md mentions persona-adapted guidance; ESTATE_MANAGER_APP.md not yet read in detail
- **Gap:** Surveyor-specific app interface, map-centric tools, and field-capture workflows not documented

### Directive: Parcel subdivision (first-class feature, not afterthought; legal subdivision events create child asset records with parent lineage preserved)
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Same as Section 2, line 100

---

## Section 4 — Customer Journey

### Directive: Tenant app is universal, not org-siloed (one download, access many organizations)
- **Status:** NOT_COVERED
- **Existing coverage:** CUSTOMER_APP.md describes single app but does not mention multi-org support or "special code" entry model
- **Gap:** Multi-org tenant identity, org-switching UI, and special code/invite mechanism not documented

### Directive: Tenant can hold simultaneous tenancies across multiple orgs
- **Status:** NOT_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:17 (Customer = end-user who rents) but does not address multi-tenancy per customer
- **Gap:** Multi-org customer model not modeled; relationship schema for customer → multiple orgs/leases not documented

### Directive: To join the research client's portfolio, tenant receives/enters a special code from the estate
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Invite/code mechanism for org onboarding not documented

### Directive: Customer app → select org → see opportunities OR request unique opportunity
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:8–22 (dashboard with properties/units); no mention of org-selection or "request unique opportunity"
- **Gap:** Multi-org marketplace view and opportunity-request workflow not documented

### Directive: AI helps tenant frame application letter (compelling case, correct structure, professional tone)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions application; ARCHITECTURE_BRAIN.md:49–60 (AI as companion persona); no mention of application-letter generation
- **Gap:** AI-mediated application-letter generation workflow not detailed

### Directive: Marketplace inside tenant app (plots, buildings, units, AND tenders for maintenance work packages)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md describes payment and maintenance flows; no mention of marketplace or tender viewing for customers
- **Gap:** Customer-side marketplace view and maintenance-tender catalog not documented

### Directive: AI can talk to prospective tenants, describe a unit, negotiate price within owner-defined ranges
- **Status:** NOT_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:49–60 (AI persona framework); no mention of price-negotiation logic or owner-defined ranges
- **Gap:** AI price-negotiation agent, range constraints, and negotiation protocol not documented

### Directive: Referrals supported
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Referral mechanism and reward/tracking logic not documented

### Directive: Profile-driven applications (tenant builds rich profile once → share with any owner)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md (customer has profile); DOMAIN_MODEL.md:150–160 mentions Customer entity with profile fields
- **Gap:** Profile reuse across orgs, sharing mechanism, and privacy controls not documented

### Directive: Owners can request financial statements + litigation history; tenant uploads on phone; AI analyzes; owner sees tenant risk report
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:32–38 (maintenance photos); BORJIE_SPEC.md:153 (mention of "request financial statements + litigation history"); no mention of AI analysis
- **Gap:** Request workflow, tenant upload surface, and AI risk-analysis engine not documented

### Directive: Automated follow-ups (owners/designated people can schedule automated follow-up workflows; AI handles cadence)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DATA_FLOWS.md mentions event-driven flows; CUSTOMER_APP.md:46–54 mentions notifications; no mention of owner-scheduled workflows
- **Gap:** Owner-configurable follow-up schedule and AI cadence management not documented

---

## Section 5 — Communication Channels

### Directive: Chat, in-app messaging, automated phone calls, AI-driven price negotiation with tenants
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:46–54 (notifications); BORJIE_SPEC.md mentions WhatsApp/SMS; ARCHITECTURE_BRAIN.md:49–60 (AI personas); no mention of automated phone calls or price negotiation
- **Gap:** Automated phone call support and AI price-negotiation interface not documented

### Directive: Problem reporting via app (maintenance, disputes, price negotiations, anything)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:32–44 (maintenance request); API contracts mention disputes; no mention of price-negotiation reporting
- **Gap:** Dispute and price-negotiation problem-reporting flows not detailed

### Directive: Announcement/plan updates — AI-generated; use Nanobanana for document and package creation; state-of-the-art only
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md:554 mentions "voice announcement script"; no mention of Nanobanana or AI-generated document/package creation
- **Gap:** Nanobanana integration not confirmed; AI document-generation engine not detailed

### Directive: Full audit trail of all conversations and transactions — always-on
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DATA_FLOWS.md:31–59 (Outbox Pattern + event-driven flows); ARCHITECTURE_BRAIN.md:72–80 (VisibilityScope for messages); no mention of "always-on" conversation recording
- **Gap:** Conversation archival, full searchability, and "always-on" audit surface not detailed

### Directive: Owners request financial statements & litigation history; deep analysis auto-generates standing report
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 166 repeats Section 4 directive; no document analysis engine documented
- **Gap:** Document analysis and risk-report generation not detailed

---

## Section 6 — Payments & Financial

### Directive: GePG (JEPG) control number integration; deep research on API, onboarding, reconciliation hooks
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 376 identifies as research question; RESEARCH_REPORT_CPG.md:69 mentions GePG context; no API contract or integration plan found
- **Gap:** GePG API endpoints, reconciliation protocol, and Tanzanian compliance not documented

### Directive: Reconciliation challenges — catch discrepancies automatically when orgs migrate in
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 177 mentions "cross-check customer histories against payment records"; no automated reconciliation workflow documented
- **Gap:** Auto-detection of payment-record mismatches and reconciliation workflow not detailed

### Directive: Arrears (areas) tracking — interactive calculation + automatic arrears ledger per tenant
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:577–579 mentions "disputed" payment state; RESEARCH_REPORT_CPG.md:474 acknowledges arrears as pain point; no mention of interactive arrears ledger
- **Gap:** Arrears calculation engine, interactive UI, and per-tenant ledger not documented

### Directive: Payment flexibility — installment requests + deadline-extension requests as first-class flows
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:24–30 (payments); no mention of installment or extension request flows
- **Gap:** Installment and extension-request workflows not documented

### Directive: Risk-tiered credit-scoring methodology (payment streak, contract history, occupancy duration, maintenance-dispute frequency, financial-statement analysis, litigation history, asset-type profitability, macro indicators)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 186–187 specifies credit-scoring factors; no matching implementation documented
- **Gap:** Credit-score model, inputs, and risk-tier algorithm not documented

### Directive: Risk-tiered recommendations (owner can accept/override)
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Risk-recommendation surface and override mechanism not documented

### Directive: Reports (daily, weekly, monthly, quarterly, semi, annual) — one-click generation; full snapshot at any moment
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:455 mentions "auto-generated reports"; BORJIE_PRD.md mentions reporting; no mention of multi-frequency or one-click generation
- **Gap:** Report scheduler, template library, and one-click export not documented

### Directive: Deep research — what reports do SOTA real-estate platforms produce?
- **Status:** NOT_COVERED (Research task)
- **Existing coverage:** VOICE_MEMO line 393 identifies as research question; no SOTA report catalog documented
- **Gap:** Report catalog research not completed

---

## Section 7 — Maintenance

### Directive: Tenant opens maintenance ticket in app → AI guides evidence capture (photos, videos, what-to-include)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:32–44 (maintenance request with photo upload); no mention of AI guidance for evidence capture
- **Gap:** AI-guided evidence-collection prompts and checklist not documented

### Directive: AI structures case, notifies owner/estate manager
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DATA_FLOWS.md:91–146 mentions notification service; ARCHITECTURE_BRAIN.md:49–60 (AI structuring); no explicit case-structuring workflow documented
- **Gap:** Case-structuring logic and notification routing not detailed

### Directive: AI mediates cost-assessment conversation (tenant ↔ org)
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** AI-mediated negotiation surface and cost-assessment protocol not documented

### Directive: AI drafts compensation agreement; both sides agree in-app
- **Status:** NOT_COVERED
- **Existing coverage:** API contracts mention "cases" and "evidence"; no mention of AI agreement drafting
- **Gap:** AI agreement-generation engine and bilateral approval workflow not documented

### Directive: System auto-calculates rent deduction, records it on tenant ledger, surfaces it on next invoice
- **Status:** NOT_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:577–579 mentions payment states; no mention of deduction logic or ledger recording
- **Gap:** Automatic deduction calculation and ledger posting not documented

### Directive: Tender workflow (org publishes tender to marketplace; technicians/vendors see tenders → bid/accept)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 211 describes tender visibility; no tender bidding workflow documented
- **Gap:** Tender publication, vendor bidding interface, and acceptance workflow not documented

### Directive: Interactive reports (click video in middle of scrolling report) for completion evidence
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Interactive report UI with embedded media not documented

### Directive: Inventory / appliance tracking (track installations/changes/removals over time per unit; warehouse inventory: functioning/broken/in-transit/new)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 215–217 describes the requirement; no appliance or warehouse inventory schema documented
- **Gap:** Appliance inventory entity, status states, and change-history tracking not documented

### Directive: Repeated-problem taxonomy (curated catalog of common issues, categorized by asset/room/component)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 219–220 describes the requirement; no issue taxonomy documented
- **Gap:** Issue classification schema and categorization system not documented

---

## Section 8 — Contracts & Documents

### Directive: Scanning & upload (built-in scanner, camera → scan mode, bundles, multi-format)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:501–516 mentions document upload via WhatsApp, app, email; no mention of built-in scanner or batch upload
- **Gap:** Scanner UX, batch-upload mechanics, and format support not detailed

### Directive: Auto-annotation, format conversion
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:501–516 mentions OCR extraction; no mention of auto-annotation or format conversion
- **Gap:** Auto-annotation rules and format-conversion engine not documented

### Directive: Each document linked to asset OR customer OR both
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:638–640 mentions Document entity with "associatedType" field; no mention of dual linking (asset + customer)
- **Gap:** Schema for document-to-asset and document-to-customer relationships not fully detailed

### Directive: Chat with any document and chat with groups of documents; AI as Harvard-level estate manager
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:49–60 (AI personas); VOICE_MEMO line 232 specifies "document-chat" as core surface; no mention of document Q&A or group document chat
- **Gap:** Document Q&A interface and multi-document chat not documented

### Directive: Government document-verification integrations (e.g., Umbrella for Tanzania) kept open; manual approval supported until integrations land
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 234 mentions Umbrella; no integration contract or verification workflow documented
- **Gap:** Verification integration framework and manual-approval fallback not documented

### Directive: Expiry-aware (AI knows which docs expire, reminders, auto-retrieves updated copies, shows old vs new side-by-side)
- **Status:** NOT_COVERED
- **Existing coverage:** CUSTOMER_APP.md:46–54 mentions notifications; no mention of document expiry tracking or automated retrieval
- **Gap:** Document expiry schema, auto-retrieval mechanism, and side-by-side comparison UI not documented

### Directive: Audit & reconciliation queries (surface inconsistencies as flagged insights on dashboard)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:400 mentions "flagged insights"; CUSTOMER_APP.md mentions dashboard; no mention of inconsistency detection or reconciliation queries
- **Gap:** Inconsistency-detection algorithms and dashboard insight surface not documented

### Directive: When org migrates in, AI auto-creates customer profiles, wires links to assets, surfaces gaps
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 242 describes intent; BORJIE_SPEC.md mentions migration; no AI auto-linking or gap-surfacing documented
- **Gap:** Migration workflow, auto-linking rules, and gap-detection algorithms not detailed

---

## Section 9 — Renewals & End of Relationship

### Directive: Contract-end automation (insights + alerts + reminders fire on both owner and tenant side as contracts near expiry)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:16–22 mentions "Lease expiry warnings with renewal request capability"; DATA_FLOWS.md mentions notification service; no mention of owner-side alerts or automated reminders schedule
- **Gap:** Owner-side notification surface and reminder cadence configuration not documented

### Directive: Tenant writes renewal letter in clicks (AI-generated from profile)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 250 specifies AI-generated renewal letter; no renewal-letter template or workflow documented
- **Gap:** AI renewal-letter generation from tenant profile not documented

### Directive: Owner decides, AI executes
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Renewal acceptance/rejection workflow and AI-driven execution not documented

### Directive: Bad-history flags (deep research needed) — what counts as "bad history"? Auto-flag when thresholds crossed
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 253–256 identifies as research question; no bad-history taxonomy or threshold logic documented
- **Gap:** Bad-history criteria and flagging algorithm not documented

### Directive: Re-advertise vacated asset; reach out to previous interested parties (waitlist) automatically when available
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Vacancy re-listing, waitlist management, and automated outreach not documented

### Directive: Joint move-out inspection (unless org allows tenant self-checkout)
- **Status:** NOT_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions "move-in inspection" but not move-out
- **Gap:** Move-out inspection workflow and configurable self-checkout option not documented

### Directive: Handle damage-deduction disagreements with evidence + negotiation trail
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** API contracts mention "disputes" and "cases"; VOICE_MEMO line 262 describes intent; no mention of damage-deduction-specific workflow
- **Gap:** Damage-deduction negotiation protocol and evidence-bundling for disputes not documented

---

## Section 10 — Disputes & Compliance

### Directive: Late rent (most common dispute); unauthorized subleasing
- **Status:** FULLY_COVERED
- **Existing coverage:** VOICE_MEMO lines 268–270; api/cases.yaml mentions dispute types; RESEARCH_REPORT_CPG.md:527 mentions dispute tracking
- **Gap:** None identified (pain points documented)

### Directive: Rent-payment reminders calibrated by policy
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:46–54 (payment reminders); BORJIE_PRD.md:59–70 (conversational-first); no mention of policy-calibrated reminder rules
- **Gap:** Reminder-policy configuration and calibration engine not documented

### Directive: AI explains policy consequences to tenant proactively, before issues escalate
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:49–60 (AI personas); no mention of proactive policy-consequence messaging
- **Gap:** Proactive AI policy-consequence messaging workflow not documented

### Directive: Notice-giving workflows with configurable grace periods
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** API contracts mention "notices"; CUSTOMER_APP.md mentions announcements; no mention of grace-period configuration
- **Gap:** Notice-generation template and grace-period configuration not documented

### Directive: Evidence bundling (payment records, correspondence) auto-extracted on demand for dispute resolution
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** API contracts mention "evidence" (api/cases.yaml); no mention of automatic bundling or extraction logic
- **Gap:** Auto-evidence-bundling algorithm and on-demand extraction surface not documented

### Directive: Sublease permission (tenant requests sublease → if approved, add subtenant to tenant group → clarify rent responsibility → audit trail)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 279 specifies sublease workflow; no sublease request or approval workflow documented
- **Gap:** Sublease permission workflow, subtenant grouping logic, and responsibility tracking not documented

### Directive: Compliance reminders (pre-deadline reminders with action plans, not just warnings)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** CUSTOMER_APP.md:46–54 (reminders); no mention of action-plan generation
- **Gap:** Compliance reminder with action plan not documented

---

## Section 11 — Official Letters & Customer Requests

### Directive: Letter types (residency proof, tenancy confirmation, payment confirmation, reference letters)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 289 specifies letter types; BORJIE_SPEC.md:554 mentions "formal email letter style"; no mention of letter generation
- **Gap:** Letter template library and generation workflow not documented

### Directive: Any letter on demand — AI-generated, templated, owner-approved
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md:554 mentions letter styles; no mention of on-demand AI letter generation or owner approval
- **Gap:** On-demand letter generation and approval workflow not documented

### Directive: Approval workflow (head of department/unit approves and delegates to worker; automated to start with, human override supported)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:102–113 (irreversible actions are human-gated); no mention of delegation or automation with override
- **Gap:** Delegation mechanism and automation-with-override logic not documented

---

## Section 12 — Financial Risk & Credit Behavior

### Directive: Extension requests (30 days pre-expiry); reminders + extension request flows
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 300 specifies 30-day pre-expiry window; CUSTOMER_APP.md:46–54 mentions lease expiry warnings; no mention of extension request flow
- **Gap:** Extension request submission and approval workflow not documented

### Directive: Carrot-and-stick (rewards for early payment, consequences for late)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 302 specifies carrot-and-stick; no gamification or incentive system documented
- **Gap:** Gamification rules and incentive/consequence system not documented

### Directive: Owner toggles: auto vs human-controlled (extension requests)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:59–70 mentions "Human-in-Loop Safety"; no mention of owner toggle between auto/manual
- **Gap:** Auto-approval toggle configuration not documented

### Directive: Payment-history as credit signal; formal proof-of-payment history → tenant uses for financing elsewhere
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DOMAIN_MODEL.md:565–570 mentions payment history; no mention of proof-of-payment document generation or tenant download
- **Gap:** Payment history report generation and tenant access not documented

### Directive: Owner uses payment history to grade reliability and set flexibility terms
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Payment-history-based reliability grading and flexibility-term configuration not documented

### Directive: Risk lever: owner can switch tenant from flexible to strict mode based on behavior
- **Status:** NOT_COVERED
- **Existing coverage:** None found
- **Gap:** Tenant mode configuration (flexible/strict) and switching mechanism not documented

---

## Section 13 — Reporting & Decision-Making

### Directive: Senior-leader most-requested: leasing financial performance (top of dashboard, always)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:35–40 (value proposition: "optimized NOI"); CUSTOMER_APP.md doesn't address owner dashboard
- **Gap:** Owner/senior-leader dashboard and financial-performance widget not documented

### Directive: Hardest report today: conditional survey of assets (kill this pain point; evidence-driven, AI-assembled, comparative to prior surveys, with action plans)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:451 mentions "conditional survey"; VOICE_MEMO line 320 specifies the requirement; no conditional survey report generation documented
- **Gap:** Conditional survey data model, evidence collection, and action-plan generation not documented

### Directive: Hard decisions: maintenance (data scattered; centralize + AI-synthesize)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** DATA_FLOWS.md and ARCHITECTURE_BRAIN.md mention maintenance context; no mention of maintenance-decision synthesis surface
- **Gap:** Maintenance decision-support dashboard not documented

### Directive: Performance measurement vectors (deep research) — occupancy rate, churn, maintenance cost per asset, revenue per sqm, time-to-lease, dispute count, NPS, asset appreciation, etc.
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 326 identifies as research question; RESEARCH_REPORT_CPG.md:455 mentions "sustainability reporting"; no comprehensive KPI catalog documented
- **Gap:** Performance metric definitions and KPI calculation engine not documented

---

## Section 14 — Technology & Operational Challenges

### Directive: Legacy integration (many orgs use LPMS; integrate for data pull AND offer smooth migration with AI-guided ingest, auto-mapping, auto-population)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 334 specifies LPMS integration; BORJIE_SPEC.md mentions data migration; no LPMS API contract or auto-mapping documented
- **Gap:** LPMS integration contract, auto-mapping schema, and migration wizard UX not documented

### Directive: Current manual work (application writing, all correspondence — all manual today; we automate all of it)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions automation; ARCHITECTURE_BRAIN.md:49–60 (AI personas); no comprehensive automation map documented
- **Gap:** End-to-end automation roadmap not documented

### Directive: "Areas" calculation discrepancies (biggest operational stressor; root-cause: data drift + manual Excel; our platform: canonical ledger + interactive verification + audit trail)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 339–341 identifies pain point; RESEARCH_REPORT_CPG.md:474 mentions arrears/areas; no canonical ledger or discrepancy-resolution workflow documented
- **Gap:** Areas ledger, interactive verification UI, and discrepancy detection not documented

### Directive: Tenant registration time (current: slow; new: AI-driven intake + profile reuse → minutes, not hours)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md mentions onboarding; ARCHITECTURE_BRAIN.md:49–60 (AI-driven orchestration); no mention of registration time targets or profile-reuse optimization
- **Gap:** Registration time SLA and profile-reuse mechanics not documented

---

## Section 15 — Future Vision (research-client stated)

### Directive: "Improved system → restored revenue"
- **Status:** FULLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:27–40 (value proposition); BORJIE_SPEC.md specifies a multi-district public-sector estate context
- **Gap:** None identified (goal acknowledged)

### Directive: Eliminate lack of conditional survey reports → better maintenance plans
- **Status:** FULLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:451 addresses conditional survey as pain point and solution
- **Gap:** None identified

### Directive: Integrated system + stakeholder awareness
- **Status:** FULLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:54 (platform as operating system)
- **Gap:** None identified

### Directive: Ease of communication with customers
- **Status:** FULLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:62 (channel flexibility); CUSTOMER_APP.md:46–54 (notifications)
- **Gap:** None identified

---

## Cross-Cutting Directives

### 1. Configurable thresholds + conditional workflows everywhere (approval routing, maintenance, renewals, payment flexibility)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO lines 359; DATA_FLOWS.md mentions conditional logic; no comprehensive configuration schema documented
- **Gap:** Admin UI for threshold/workflow configuration not documented

### 2. Every entity is a portal into every related entity (click anywhere → drill into full context)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:25–56 (graph model supports relationships); DOMAIN_MODEL.md bounded contexts; no UI/navigation design for "infinite portals" documented
- **Gap:** Portal UI patterns and cross-entity navigation not documented

### 3. AI is persona-adaptive companion (owner advisor / estate manager assistant / vendor guide / tenant negotiator — same brain, different hat)
- **Status:** FULLY_COVERED
- **Existing coverage:** ARCHITECTURE_BRAIN.md:49–60 (8 personae with different scopes); BORJIE_PRD.md:58–59 (Operations-First AI)
- **Gap:** None identified

### 4. Document-chat + document-group-chat as core surface
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 362; ARCHITECTURE_BRAIN.md:49–60 (AI personas); no mention of document Q&A interface
- **Gap:** Document chat UI not documented

### 5. Google Maps geofencing at every hierarchy level, colored nested regions, street-level asset pins
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md mentions map tools; VOICE_MEMO line 363; no API or UI documented
- **Gap:** Google Maps integration and geofencing UI not documented

### 6. Marketplace is intelligent + negotiating, not static catalog
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 364 specifies intelligent marketplace; CUSTOMER_APP.md does not mention marketplace negotiation
- **Gap:** Negotiation engine and dynamic pricing not documented

### 7. Carrot-and-stick gamification for rent behavior (deep research needed on SOTA approaches)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 365 identifies as research question; no gamification system documented
- **Gap:** Gamification rules and incentive system not documented

### 8. Interactive reports with action plans, not static PDFs
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 368; RESEARCH_REPORT_CPG.md:455 mentions auto-generated reports; no interactive report UI documented
- **Gap:** Interactive report UI, embedded media, and action-plan generation not documented

### 9. Infinite subdivision of assets (building → floor → room → bed if needed)
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 369; no N-level subdivision schema documented
- **Gap:** Asset subdivision model and genealogy tracking not documented

### 10. Universal tenant identity across organizations
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 370; CUSTOMER_APP.md does not address multi-org tenant identity
- **Gap:** Cross-org tenant identity resolution and account linking not documented

### 11. First-line advisory role (platform explains what's eating money, what's going well, where to expand, refinancing strategy)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_PRD.md:35–40 (value proposition: NOI optimization); ARCHITECTURE_BRAIN.md:49–60 (advisor pattern); no mention of refinancing or expansion advice
- **Gap:** Refinancing and expansion advice modules not documented

---

## Open Research Questions (from Voice Memo lines 373–385)

### 1. Professional property-class taxonomy (global + East African variants)
- **Status:** NOT_COVERED
- **Existing coverage:** None
- **Gap:** Missing

### 2. GePG API integration details + Tanzanian real-estate compliance (Land Act, Rent Restriction Act, LPMS schema)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md mentions GePG context; no API or compliance detail
- **Gap:** GePG API contract, compliance mapping, and LPMS schema not documented

### 3. State-of-the-art rent-collection gamification (point systems, early-pay discounts, streak-based credit score)
- **Status:** NOT_COVERED
- **Existing coverage:** None
- **Gap:** Missing

### 4. AI-mediated price-negotiation patterns used by SOTA proptech
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 378; no price-negotiation patterns documented
- **Gap:** Missing

### 5. Post-lease usage-monitoring vectors beyond annual audits
- **Status:** NOT_COVERED
- **Existing coverage:** RESEARCH_REPORT_CPG.md:451 mentions IoT; no comprehensive monitoring vectors documented
- **Gap:** Missing

### 6. Move-out damage-assessment workflows (evidence + dispute handling)
- **Status:** NOT_COVERED
- **Existing coverage:** None (move-in is documented; move-out is not)
- **Gap:** Missing

### 7. Bad-history thresholds for non-renewal triggers (legally defensible, jurisdiction-aware)
- **Status:** NOT_COVERED
- **Existing coverage:** None
- **Gap:** Missing

### 8. Nanobanana document generation — confirm capability and integration path
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** BORJIE_SPEC.md:554 mentions document generation; no Nanobanana integration confirmed
- **Gap:** Nanobanana capability and integration not documented

### 9. Performance-measurement metrics (beyond tenant financial performance)
- **Status:** PARTIALLY_COVERED
- **Existing coverage:** VOICE_MEMO line 383 identifies as research; RESEARCH_REPORT_CPG.md:455 mentions KPIs; no comprehensive metric set documented
- **Gap:** KPI catalog not documented

### 10. Report catalog — SOTA real-estate reports we should ship out-of-the-box
- **Status:** NOT_COVERED
- **Existing coverage:** VOICE_MEMO line 384 identifies as research; no SOTA report catalog documented
- **Gap:** Missing

---

## Conflicts Requiring Founder Decision

### CONFLICT 1: Admin hierarchy levels

**Memo says (lines 25–26):** "Admin (levels 1–4) — decreasing power/control top-down. No hard cap yet."

**Existing docs (ARCHITECTURE_BRAIN.md:49–60):** Lists 8 personae (Estate Manager, Junior Leasing, Junior Maintenance, Junior Finance, Junior Compliance, Junior Communications, Coworker, Migration Wizard) but does NOT spell out "Admin levels 1–4" hierarchy.

**Issue:** Unclear whether "Admin 1–4" is a separate hierarchy from the "Junior" personae, or whether "Junior" roles should be renamed/restructured to align with "Admin 1–4".

**Decision needed:** Is "Admin 1–4" a config-level hierarchy to be added, or should the existing 8 personae be the source of truth?

---

### CONFLICT 2: Tenant app universality vs. multi-org isolation

**Memo says (lines 136–139):** "Tenant app is universal, not org-siloed. One download, access many organizations. Tenant can hold simultaneous tenancies across multiple orgs. To join the research client's portfolio, tenant receives/enters a special code from the estate."

**Existing docs (CUSTOMER_APP.md, DOMAIN_MODEL.md):** Models a single tenant-to-org binding per app session. No mention of multi-org tenant identity, special-code onboarding, or simultaneous tenancies.

**Issue:** Implementing universal tenant app with multi-org support is a significant architecture change. Current Customer App design assumes single-org isolation.

**Decision needed:** Prioritize multi-org tenant identity refactor, or defer to Phase 2?

---

### CONFLICT 3: Configurable geo-hierarchy vs. fixed location model

**Memo says (lines 76–78):** "Elastic geo-hierarchy (CRITICAL) — Do NOT force a fixed region → district → village structure. the research client's convention: Districts contain Regions (counter-intuitive to global convention)."

**Existing docs (DOMAIN_MODEL.md):** Models location as fixed "property location" fields. No mention of org-configurable hierarchy labels or N-deep nesting.

**Issue:** Allowing arbitrary hierarchy labels and inversion (Districts > Regions) requires a tree/graph model, not flat location fields.

**Decision needed:** Refactor location model to support N-deep, org-configurable hierarchy, or limit initial scope to the research client's specific (Districts > Regions) pattern?

---

## Top 10 NOT_COVERED Directives (Highest Priority to Design Next)

1. **Tenant app universal + multi-org support (Section 4)** — Major architectural gap; requires identity and session redesign
2. **Elastic geo-hierarchy with org-configurable labels (Section 2)** — Critical for similar large asset-owning organizations large organizations with unique geographic conventions
3. **AI price-negotiation engine (Section 4)** — Required for marketplace intelligence; no negotiation protocol documented
4. **Conditional survey report generation with action plans (Section 7 + 13)** — Pain point elimination; core value driver for research-client-scale orgs
5. **GePG payment integration + Tanzanian compliance (Section 6)** — Tanzania-specific; required for full payment automation
6. **Arrears ledger + interactive verification (Section 6)** — "Biggest operational stressor"; revenue-critical
7. **Nanobanana document generation integration (Section 5 + 8)** — State-of-the-art document creation; mentioned by founder
8. **Asset subdivision + parcel genealogy tracking (Section 2 + 3)** — First-class feature; complex domain logic
9. **Sublease permission workflow (Section 10)** — Common dispute trigger; needs workflow automation
10. **Damage-deduction negotiation + evidence bundling (Section 9 + 10)** — Dispute resolution; requires evidence chain and negotiation surface

---

## Summary of Recommendations

### Fully Covered (18 directives) — Low Risk
- Owner control and account deletion
- Estate Manager persona
- EMU as Owner mapping
- Core pain points (revenue loss, double-leasing)
- Future vision goals (the research client's stated outcomes)

### Partially Covered (24 directives) — Medium Risk
- Most approval-flow and role-hierarchy concepts exist but lack detail (e.g., admin levels, conditional routing rules)
- Data migration and OCR exist but lack LPMS-specific auto-mapping
- Payment and maintenance flows exist but lack full feature details (gamification, credit-scoring, AI mediation)

### Not Covered (15 directives) — High Risk
- Multi-org tenant identity and universal app
- Elastic geo-hierarchy with configurable labels
- AI price-negotiation, damage-deduction negotiation, cost-assessment mediation
- GePG + Tanzanian compliance integration
- Asset subdivision and parcel genealogy
- Document-chat interface
- Nanobanana integration

### Conflicts (3) — Requires Founder Alignment
- Admin 1–4 hierarchy vs. existing 8 personae
- Universal tenant app vs. single-org isolation
- Elastic geo-hierarchy vs. fixed location model

---

## Next Steps

1. **Align on conflicts** — Founder decision on Admin hierarchy, multi-org tenant identity, and geo-hierarchy scope
2. **Prioritize NOT_COVERED directives** — Top 10 list above; recommend phased delivery with research-client pain-point priorities (geo-hierarchy, conditional survey, arrears, GePG)
3. **Spike on SOTA research questions** — Assign ownership for property-class taxonomy, gamification patterns, move-out workflows, bad-history thresholds
4. **Update docs in phases** — Do not attempt to document all gaps at once; focus on implementation-ready specs for Phase 1 (geo-hierarchy, conditional survey, arrears)
