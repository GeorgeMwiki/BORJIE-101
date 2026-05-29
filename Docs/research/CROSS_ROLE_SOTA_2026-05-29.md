# Cross-Role Chain — SOTA Research

**Date:** 2026-05-29
**Scope:** State-of-the-art for cross-role workflow chains in
industry-cloud (mining), HR/people-ops, and safety domains, plus how
they inform Borjie's HR-onboarding, payroll, and safety-incident
chains.
**Audience:** Builders of `services/api-gateway/src/services/*` and
the chain orchestrators for #193.

---

## 1. Salesforce Industries (Manufacturing Cloud / Industries AI)

Reference: Salesforce Industries AI launch — May 2026.

**What they do well**
- Pre-built data models bind cross-role objects (Quote -> Order ->
  Shipment -> Settlement) into a single declarative pipeline with
  Flow Orchestrator.
- Industries AI ships **persona-shaped Agentforce agents** per role
  (Sales Rep, Operations Manager, Finance Controller) — each agent
  has its own tool catalogue and approval boundary.
- Commodity-price feed integration so quoting / settlement always
  uses the latest spot price.
- Process-mining surface flags chain bottlenecks (e.g. RFB ->
  fulfilment lag > SLA) automatically.

**What Borjie inherits**
- Persona-shaped tool catalogues (already done via
  `packages/central-intelligence/src/brain-extensions/persona-tool-catalog`).
- Chain SLA observation -> we copy this in the new
  `cockpit.SafetyIncidentEvent` pulse + payroll-run telemetry.

**Gap vs. Borjie**
- Salesforce has no Tanzanian mining vertical or M-Pesa B2C.
- We do not need their Flow Orchestrator GUI — chain is declared in
  TypeScript orchestrators per CLAUDE.md modular-monolith rules.

---

## 2. SAP S/4HANA + SuccessFactors Employee Central (1H 2026 release)

Reference: SAP SuccessFactors 1H 2026 Employee Central Payroll
release notes; "From Compliance to Productivity" mining whitepaper.

**HR onboarding pattern**
1. **Recruiter** posts requisition in Recruiting Management.
2. Candidate completes pre-hire data on a public Career Site link.
3. **Hiring Manager** approves; auto-creates Employee Central
   employee master record (single source of truth).
4. SuccessFactors **replicates** onboarding form data straight into
   Employee Central Payroll (the May 2026 Synchronization HR SP
   eliminated the prior manual handoff).
5. **HR Admin** validates statutory fields (tax IDs, bank).
6. Onboarding tasks (badge, IT account, payroll enrolment) fan out
   to assignees via the Joule assistant.
7. Worker becomes "active" on first shift.

**What Borjie copies**
- Single master record: every workforce row keys off
  `workforce_invitations` -> `users` -> `workforce_certifications`
  with no parallel HR table.
- One-shot replication into payroll — Borjie payroll reads the same
  `users` + `mining_clock_events` + `shift_reports` rows; no copy.
- Bilingual sw/en assistant prompts mimic Joule's "single nudge per
  pending action".

**What Borjie skips**
- No statutory tax/IRS pre-validation step (Tanzania PAYE is added
  in #193.b deferred sub-issue).
- No requisition-board UI — workforce_openings is server-only for
  v1; owner-web ships a single-column list.

---

## 3. Workday HCM + Lattice (people-ops chain)

Reference: Lattice + Workday partner-program GA, Lattice HRIS launch
2025, Workday HCM payroll docs.

**Onboarding -> payroll chain**
1. Workday HCM is the system-of-record for employee data.
2. Lattice subscribes via one-way SFTP sync — keeps Lattice talent
   data in step.
3. Performance reviews + bonus rec flow back to Workday Compensation
   for payroll bonus lines.
4. Workday Payroll posts to GL via period-end batch.

**What Borjie copies**
- One-way data flow from operational source (mining_clock_events +
  shift_reports) into payroll calculation — no bidirectional sync.
- Bonus / overtime / deductions modelled as line items on a payroll
  run, not on the worker record. (mirror's Workday's Compensation
  Plan -> Payroll Bonus link.)
- Period-end batch posting through a single ledger interface
  (LedgerService.post()).

**Why Borjie's flow is simpler**
- One tenant per mine -> no global payroll routing.
- M-Pesa B2C bulk-payout replaces 50-country payroll partner mesh.

---

## 4. BambooHR (SMB onboarding)

**Patterns we adopt**
- Friction-light invitation: SMS/WhatsApp deep-link replaces email
  for the candidate first-touch (already done in
  `workforce-invitations`).
- Document checklist per role (PPE issue, safety briefing, contract
  signature) tracked on the candidate row.
- Manager approval is the gate that flips status to "active".

**Patterns we omit**
- BambooHR's e-signature widget — Borjie uses
  `services/api-gateway/src/services/document-drafter` + the existing
  `documents.hono.ts` signature surface.

---

## 5. Global Mining Guidelines Group (GMG) — System Safety (Mar 2024)

Reference: GMG "System Safety for Mining" guideline, GMG functional
safety for autonomous systems, GMG cybersecurity working group.

**Incident-reporting chain (GMG recommended)**
1. Worker / sensor raises a notification within minutes of detection.
2. **Site supervisor** triages severity (low / medium / high /
   critical / fatality).
3. Severity drives escalation:
   - low/medium -> manager investigation queue.
   - high -> owner notified + 24h investigation SLA.
   - critical / fatality -> regulator notification within 24h
     (OSHA equivalent; in TZ it is OSHA-TZ + Mining Commission).
4. **Compliance officer** drafts regulator filing from incident.
5. Root-cause analysis stored as immutable record (audit chain).
6. Corrective actions tracked to closure with assignee + deadline.
7. **System provider** notified for any tech-caused incident (per
   GMG autonomous-systems guideline).

**What Borjie's chain implements**
- Severity-driven escalation: low/medium -> manager queue; high ->
  owner pulse via R6 SSE + manager queue; critical / fatality ->
  immediate owner + admin-web compliance officer + automatic
  regulator filing draft.
- 24h SLA timer (cron worker — issue #193.future).
- Append-only audit chain on every state transition
  (`ai_audit_chain` table).
- Bilingual sw/en notification copy.
- Cockpit event kind: `SafetyIncidentEvent` on the owner R6 SSE
  stream.

**What we defer**
- Automatic system-provider notification — Borjie's autonomous
  systems are AI agents (Mwikila), not third-party. Maintained via
  the existing kill-switch fail-closed rule.

---

## 6. Cross-cutting takeaways for Borjie

| Concern | SOTA winner | Borjie adoption |
|---|---|---|
| Persona-shaped agents | Salesforce Industries AI | Already done — persona tool catalogue |
| Single master record | SAP SuccessFactors | Already done — users + workforce_invitations |
| One-way operational -> payroll | Workday HCM | Adopted in L-B (payroll reads clock-events + shift-reports) |
| Friction-light onboarding | BambooHR | Adopted — SMS deep-link |
| Severity-driven safety escalation | GMG | Adopted in L-C escalator |
| Append-only audit chain | All | Already done — ai_audit_chain |
| Bulk-payout via local rails | none (Borjie original) | M-Pesa B2C through LedgerService.post() |

---

## 7. Sources

- Salesforce Industries AI launch (May 2026):
  https://www.salesforce.com/news/stories/industries-ai-announcement/
- SAP SuccessFactors 1H 2026 — Employee Central Payroll:
  https://community.sap.com/t5/human-capital-management-blog-posts-by-members/sap-successfactors-1h-2026-what-s-new-in-employee-central-payroll/ba-p/14375522
- SAP S/4HANA HR-led mining case study:
  https://www.miningnews.net/resourcestocks/partner-content/4531811/compliance-productivity-hr-led-case-sap-4hana-mining
- Workday + Lattice partnership:
  https://lattice.com/blog/lattice-and-workday-partnership
- Lattice vs Workday comparison (2026):
  https://www.softgalley.com/compare/lattice-vs-workday
- GMG System Safety guideline (Mar 2024):
  https://gmggroup.org/wp-content/uploads/2024/08/System-Safety.pdf
- GMG functional safety for autonomous mining:
  https://www.amsj.com.au/new-guidelines-published-for-autonomous-mining-global-mining-guidelines/
- Compliance best practices for mining:
  https://www.ganintegrity.com/resources/blog/compliance-best-practices-for-mining/
