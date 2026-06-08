# HANDS · The Autonomous-Service Operating Model

**Lane:** `autonomous-service-operating-model`
**Dossier date:** 2026-06-08
**Author:** Research subagent (SOTA scan, June-2026 sources)
**Scope:** What it MEANS to be a SERVICE that DOES the work — not a SaaS product.
**Sibling applicability:** Borjie (mining estate OS) and BossNyumba (real-estate OS) share one
brain/wiring; this lane is domain-agnostic. Every claim here applies to both. The actuator
landscape below is anchored on the **Tanzania launch jurisdiction** (then KE/UG/NG).

---

## 0. The thesis in one paragraph

Borjie/BN is **INV-F**: a service that does the actual work end-to-end through real-world
actuators (mobile-money rails, WhatsApp/SMS, regulator e-services, assay labs, refiners,
offtakers), with the default of **DO, not suggest**. The 2026 market has a precise name for
this: **service-as-software** — the model where the customer pays for *completed business
outcomes* rather than seats or API access, and the vendor assumes operational responsibility
for the work. The entire industry is mid-migration from per-seat SaaS to per-work-done. The
strategic consequence is brutal and clarifying: **the moment you act in the real world, you
own the consequences.** Autonomy is not a liability shield (California AB 316, eff.
2026-01-01). So the winning architecture is not "a smarter agent" — it is a **fiduciary-grade
autonomous operator** whose every act is identity-bound, authority-scoped, evidence-cited,
cryptographically auditable, insured, and gated by human four-eyes on the irreversible step.
That trust substrate *is* the product. The "AI firm that runs your estate" is what we are
building; this dossier maps the bar and our gaps.

---

## 1. SOTA findings — the 2026 landscape

### 1.1 The model shift: SaaS → service-as-software (pay for work, not seats)

The macro shift is now consensus, not speculation:

- **Bloomberg** projects subscription pricing falls from ~60% → ~30% of software pricing over
  the decade, while **outcome-based pricing rises from ~10% → ~60%**.
  ([RSM](https://rsmus.com/insights/industries/technology-companies/saas-vendors-pricing-models-ai.html),
  [Monetizely 2026 guide](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models))
- **Gartner:** by 2030 ≥40% of enterprise SaaS spend shifts to usage/agent/outcome pricing;
  seat-based revenue share falls 21% → 15%. **IDC** is faster: 70% of vendors abandon pure
  per-seat by 2028, *because AI agents reduce the number of human seats needed*.
- The framing that matters: **"AI agents are doing to SaaS what SaaS did to license
  software"** — buyers now "hire software to do work" and "judge agents by the workflows they
  complete and the business outcomes they deliver," not by access.
  ([HighRadius](https://www.highradius.com/resources/Blog/saas-pricing-models/),
  [Medium / Future of SaaS](https://medium.com/@topper440/the-future-of-saas-db14cc7e5ab9))
- **AI-native services = "solution providers that deliver completed business outcomes using
  autonomous AI systems — replacing software tools, co-pilots, AND outsourced labor."** The
  operative line: *"the AI-native service provider simply executes the workflow and delivers
  the final outcome,"* eliminating the "human pilot to prompt, guide, and validate."
  ([Ability.ai](https://www.ability.ai/blog/ai-native-services-outsourcing))
- The revenue logic: under subscriptions, revenue is **capped by the customer's headcount**;
  outcome pricing removes the ceiling and scales with *work volume* (invoices processed, money
  recovered, code shipped). ([RSM](https://rsmus.com/insights/industries/technology-companies/saas-vendors-pricing-models-ai.html))

**Live price points (proof this is real, not theory):** Zendesk $1.50/committed automated
resolution; HubSpot dropped its Customer Agent to **$0.50 per resolved conversation** (Apr
2026); Sierra and Intercom Fin price per-resolution. Invoice-automation vendors now bill on
"invoices accurately processed end-to-end" and "exceptions resolved without manual
intervention." ([Fin.ai](https://fin.ai/learn/ai-customer-service-agent-pricing-comparison),
[Sierra](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents),
[HighRadius outcome pricing](https://www.highradius.com/resources/Blog/outcome-based-pricing-ai/))

### 1.2 The contract shifts from a SaaS EULA to a BPO-style services agreement

This is the single most important structural finding. Mayer Brown (Feb 2026): as agentic AI
shifts from passive tool to autonomous actor, contracts move **"beyond SaaS to a hybrid
incorporating BPO-style clauses."**
([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2026/02/contracting-for-agentic-ai-solutions-shifting-the-model-from-saas-to-services))

| Dimension | Old SaaS EULA | New service-as-software agreement |
|---|---|---|
| SLA | "99.99% uptime" (platform availability) | **Outcome SLA**: "99% of invoices processed correctly", "<1% of autonomous actions lead to a consumer complaint" |
| Warranty | "AS-IS, WITH ALL FAULTS" | Services performed "in a good, professional, diligent, workmanlike manner per industry standards" — covers AI + human oversight |
| Indemnity | Narrow IP-infringement only | Broad: "third-party claims arising from the agent's autonomous performance," carve-outs for customer misconfig / bad data |
| Audit | SOC 2 report | **Rights to transparency**: technical audit of decision logs ("why did it do that?"), operational assessment vs SLA |
| Data | Vague | Explicit ban on training/fine-tuning on customer data without approval; customer owns inputs+outputs |
| Oversight | None | **Delegation of authority + policy guardrails**: mandatory escalation triggers before certain acts — defines the liability boundary |

The AI agent SLA **cannot be a SaaS uptime page**: "the app can be online, the API can return
200, and the agent can still fail by choosing the wrong tool, inventing a detail, or taking 90
seconds." SLAs must cover *uptime + accuracy + response-time + tool-correctness*.
([buildmvpfast](https://www.buildmvpfast.com/blog/ai-agent-sla-uptime-accuracy-response-time-guarantee-2026))

### 1.3 Trust & liability: autonomy is NOT a shield (the load-bearing legal reality)

- **California AB 316 (eff. 2026-01-01):** a defendant **cannot** use an AI system's
  "autonomous operation" as a defense. Applies across the whole supply chain — anyone who
  "developed, modified, or used" the system. Not strict liability, but the "the AI did it"
  argument is dead; reasonable safeguards + testing + documentation remain the defense.
  ([Baker Botts](https://www.bakerbotts.com/thought-leadership/publications/2026/january/california-eliminates-the-autonomous-ai-defense-what-ab-316-means-for-ai-deployers))
- **The universal principle:** "Deploying an AI agent does not transfer accountability to the
  agent; it **concentrates accountability on the deployer**." Regulatory consensus:
  *autonomy is not a shield from liability — responsibility flows to whoever deploys and
  controls the agent.* ([The Lyon Firm](https://thelyonfirm.com/blog/agentic-ai-liability-legal-responsibility-autonomous-ai-agents/))
- **Singapore Model AI Governance Framework for Agentic AI** (IMDA, launched at Davos
  2026-01-22, world's first agentic-specific national framework): *"deploying organizations
  and overseeing humans are accountable for agent behaviors regardless of voluntary
  compliance."* ([Baker McKenzie](https://www.bakermckenzie.com/en/insight/publications/2026/01/singapore-governance-framework-for-agentic-ai-launched))
- **EU AI Act:** high-risk Annex III obligations reach full enforcement **2026-08-02** —
  demonstrable human oversight becomes a legal requirement, plus concrete technical
  requirements (logging, traceability) for AI influencing employment/lending/essential
  services. ([dev.to compliance](https://dev.to/igorganapolsky/your-compliance-team-will-ask-for-an-ai-agent-audit-trail-before-august-2-heres-the-part-most-h2n))
- **Fiduciary doctrine bites:** a director's Duty of Care requires being "reasonably
  informed"; relying on a "stochastic model that figures out your numbers" can be a *breach*.
  As we move AI-as-tool → AI-as-agent ("the machine initiates, decides, executes without human
  involvement"), the fiduciary question — *who is the fiduciary, the human or the vendor?* —
  becomes live. ([Zwillgen — Fiduciary in the Machine](https://www.zwillgen.com/artificial-intelligence/the-fiduciary-in-the-machine/),
  [DataVaultAlliance manifesto](https://datavaultalliance.com/risk-governance/manifesto-defensible-analytics-agentic-ai/))

### 1.4 The human-oversight tier (managed service with escalation / four-eyes)

The SOTA pattern is a **risk-graded autonomy ladder**, not a binary:

- **Three oversight modes:** human-*out*-of-the-loop (autonomous execute) · human-*in*-the-loop
  (pause + route for approval) · human-*on*-the-loop (monitor flows for anomalies) — chosen
  **dynamically by risk, context, policy**.
- **Four gating dimensions** decide whether an act needs review: **irreversibility** (can it be
  undone?), **blast radius** (how many records/people?), **compliance exposure** (legal/reg
  obligation created?), **confidence** (how sure is the agent?).
- **Tiered escalation:** low-stakes + reversible → autonomous; high-stakes/irreversible →
  human confirm before execution; out-of-parameters → escalate to a **named reviewer**.
- **Calibrated confidence thresholds:** start conservative (0.85 irreversible, 0.70
  reversible), then recalibrate after 30 days of production data against Expected Calibration
  Error to hit a target false-positive rate matched to reviewer capacity.
  ([Galileo](https://galileo.ai/blog/human-in-the-loop-agent-oversight),
  [MyEngineeringPath HITL patterns](https://myengineeringpath.dev/genai-engineer/human-in-the-loop/),
  [Medium / Anna Jey](https://medium.com/@arvisionlab/human-in-the-loop-ai-agents-how-to-add-approvals-escalation-and-safe-autonomy-in-production-0a21e359781c))

This maps *exactly* onto INV-F's "money/licence/deletion HITL on the irreversible step."

### 1.5 Audit + explainability as the trust substrate

The market converged on **tamper-evident, cryptographically anchored provenance** as the
foundation of trust:

- An AI agent audit trail = "a structured, queryable record of *every* tool call, policy
  evaluation, data access, and governance decision, with enough context to reconstruct what
  happened and *why*."
- **Verifiable Interaction Ledgers:** every agent-tool transaction is **hashed AND bilaterally
  signed by both parties**; each message's hash locks its content; the hash chain links each
  to the previous, "a graph that cannot be rewritten retroactively without invalidating the
  whole structure." (This is precisely Borjie's hash-chained `ai_audit_chain`.)
- An emerging **IETF draft (`draft-sharif-agent-audit-trail-00`)** proposes a standard logging
  format for autonomous AI — a standardization signal worth tracking.
  ([nono.sh tamper-evident audit](https://nono.sh/blog/secure-agent-audit),
  [AI Accelerator Inst. — cryptographic proof](https://www.aiacceleratorinstitute.com/verifiable-execution-for-ai-agents/),
  [IETF draft](https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/))

### 1.6 The agent identity / authority control plane (auth shifts from access → authority)

The 2026 "next battleground." An autonomous operator that moves money needs more than RLS:

- The shift is **from access control to authority control**: every action tied to **explicit
  intent + approval**, every permission **scoped and time-bound**, every authorization decision
  **provable after the fact**.
- An agent identity must bind four things: **(1)** a unique principal (never pooled/shared);
  **(2)** cryptographic credentials (non-transferable, rotatable, hardware-backed);
  **(3)** scoped authority (explicit, enforceable, revocable limits on decisions/actions);
  **(4)** a verifiable **delegation chain** (who authorized this agent, on whose behalf, under
  what human accountability).
- For payments specifically: **parameterized payment tokens** authorized at agent-creation that
  limit authority **by merchant, amount, use-case** — not broad payment-method access. The
  **FIDO Alliance** stood up an Agentic Authentication Technical Working Group + agent-initiated
  commerce specs (2026).
  ([Entrust — authorization/delegation](https://www.entrust.com/blog/2026/05/ai-agent-authorization-delegation-zero-trust),
  [Entrust — control plane](https://www.entrust.com/blog/2026/04/the-agentic-enterprise-needs-a-new-control-plane),
  [FIDO Alliance](https://fidoalliance.org/fido-alliance-to-develop-standards-for-trusted-ai-agent-interactions/))

### 1.7 Insurance / bonding of autonomous actions (the new risk-transfer layer)

A service that does real-world work is uninsurable under legacy policies — a market is forming:

- "An autonomous agent executing financial transactions creates liability standard business
  insurance is **not designed to cover**." Traditional cyber/E&O policies are **actively adding
  AI exclusions**, leaving deployers with **zero coverage**.
- New affirmative products: **Armilla** (underwritten at Lloyd's, 2025) covers AI-specific risks
  — hallucinations, model drift, deviation from expected behavior; **HSB / Munich Re** launched
  AI liability for SMBs (Mar 2026); YC-backed **Klaimee** ("you deploy agents, we cover you").
- Best-practice structure: AI coverage written **affirmatively, with explicit triggers, clear
  exclusions, and a SEPARATE aggregate** so an AI loss doesn't consume the whole cyber limit.
  ([Marketing AI Institute — insurers excluding AI](https://www.marketingaiinstitute.com/blog/insurers-move-to-exclude-ai-risks),
  [Pearl Health — missing insurance market](https://www.pearlhealth.com/blog/the-missing-market-why-agentic-ai-needs-its-own-insurance-ecosystem),
  [Insurance of Agentic AI (arXiv 2606.05449)](https://arxiv.org/html/2606.05449))

### 1.8 The real Tanzania actuator landscape (what "does the work" touches)

The service is only as real as its actuators. June-2026 ground truth for the launch market:

**Mobile-money rails (the money actuators):**
- **M-Pesa / Vodacom — Daraja API** (Daraja 3.0). **C2B** = customer pays business (STK Push /
  Pay Bill / Till) for collections; **B2C** = business pays out (royalty settlements, supplier
  payouts, salary/wage disbursement, refunds). A **B2C M-Pesa Business Account** requires a
  *formally registered Tanzanian business*; setup is free via a Vodacom Key Account Manager.
  ([Safaricom Daraja](https://developer.safaricom.co.ke/),
  [KenZobe B2C vs C2B](https://www.kenzobe.com/blog/mpesa-b2c-vs-c2b),
  [ClickPesa M-Pesa disbursement](https://clickpesa.com/m-pesa-disbursement-explained-setup-limits-and-options/))
- **Airtel Money — Airtel Africa Developer Portal** (RESTful collection + disbursement APIs).
  ([developers.airtel.africa](https://developers.airtel.africa/),
  [ClickPesa Airtel guide](https://clickpesa.com/payment-gateway/payment-and-payout-methods/airtel-money-api-integration-guide/))
- **Mixx by Yas (Tigo Pesa)** + **HaloPesa** + **EzyPesa** — integrable via licensed
  aggregators. ([ClickPesa Mixx/Tigo](https://clickpesa.com/payment-gateway/payment-and-payout-methods/mixx-by-yas-tigo-pesa-api-integration-guide/))
- **Aggregator path (recommended first integration):** **ClickPesa** and **PayIn** are licensed
  TZ PSPs that unify M-Pesa + Mixx-by-Yas + Airtel + HaloPesa behind one API, with settlement
  schedules, split payments, and disbursement management. **TIPS** (Tanzania Instant Payment
  System) — the national real-time clearing rail — processed **454M transactions in 2024** (≈2×
  2023), the inter-operable bank/mobile-money backbone.
  ([PayIn](https://payin.co.tz/),
  [Ocdeed — TZ digital payments](https://ocdeedtechbites.app/blog/tanzania-s-digital-payment-revolution-how-far-have-we-really-come))

**Messaging actuators (the comms that close the loop with humans):**
- **WhatsApp Business Cloud API** — Meta moved to **per-message** billing (Jan 2026) for
  business-initiated templates; **utility/authentication** messages cost ~80–90% less than
  marketing; only *delivered* messages are charged; rates vary by recipient country. This is the
  primary channel for confirmations, approvals, exception escalation, settlement receipts.
  ([WhatsApp pricing 2026 — Uptail](https://www.uptail.ai/blog/whatsapp-business-api-pricing-2026-what-it-costs-and-how-billing-works),
  [Meta dev docs pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing))
- **SMS** fallback for feature-phone artisanal miners (low-end devices dominate the segment).

**Regulator / institutional actuators (the compliance closed loop):**
- **Tume ya Madini (Mining Commission) — IDRAS** = Integrated Domestic Revenue Administration
  System, launched **May 2026**, 24/7 online, **integrated with TRA**: handles withholding-tax
  calcs, PAYE, and tax-return submission for the mining sector. This is the *direct* royalty /
  mining-tax actuator. FY25/26 collected Sh1.2T (by 18 May); FY26/27 target Sh1.4T.
  ([Mining Commission IDRAS launch](https://www.therespondents.co.tz/2026/05/mining-commission-launches-new-digital.html),
  [Tume ya Madini](https://www.tumemadini.go.tz/publications/forms/))
- **TRA — Taxpayer Portal** (`taxpayerportal.tra.go.tz`) for tax registration/filing; **Digital
  Service Tax** regime exists. ([TRA](https://www.tra.go.tz/),
  [TRA portal guide](https://mabumbe.com/tra-taxpayer-portal-login/))
- **BRELA — Online Registration System** (`ors.brela.go.tz`): company/business-name
  registration, change of particulars, annual returns/maintenance fee, industrial licences,
  marks/patents — the business-registry actuator. ([BRELA ORS](https://ors.brela.go.tz/orsreg/searchbusinesspublic))
- **Domain actuators:** assay labs (grade/quality verification), refiners, offtakers — the
  physical mineral closed loop the marketplace settles against.

> Reality check: most of these regulator portals are **e-service web portals, not open REST
> APIs**. "Doing the work" at the regulator layer means a mix of (a) direct API where one
> exists (Daraja, Airtel, WhatsApp Cloud), (b) aggregator API (ClickPesa/PayIn for the long
> tail of wallets), and (c) **assisted/RPA-style portal automation with a human four-eyes
> confirm** for IDRAS/TRA/BRELA until/unless official APIs ship. Design for graceful
> degradation across these tiers.

---

## 2. Beyond-today — the leaps (each finding → a frontier move)

1. **From "agent that suggests" → the AI FIRM that operates.** Package Mr. Mwikila as a
   **fiduciary-grade managed operator** with a published *operating charter*: defined duties of
   care/loyalty, a delegation-of-authority matrix, and a per-tenant **Fiduciary Statement** that
   any owner, auditor, or regulator can read. The product is not software — it's an
   *institution* with provable accountability.

2. **Outcome-priced on mining work-done, not seats.** Price on **TZS royalty settled on time**,
   **arrears recovered**, **assays cleared**, **offtake contracts closed**, **compliance filings
   accepted by TRA/IDRAS**. Meter the actuator outcomes the closed-loop fabric already confirms.
   Beyond: a **performance bond / clawback** — if the MD misses an outcome SLA, fees auto-rebate
   from the ledger (provable because every outcome is hash-chained).

3. **The Trust Receipt.** For every autonomous act, emit a portable, signed **Trust Receipt**:
   {intent, authority-grant id, evidence_ids, confidence, policy rule matched, four-eyes
   approver, actuator response, reversal/compensation handle}. It's the human-readable face of
   the `ai_audit_chain` — the artifact an insurer underwrites against and a court accepts. Beyond:
   align it to the **IETF agent-audit-trail** format so it's portable across the agent economy.

4. **Bonded autonomy tiers.** Map the risk-graded ladder (§1.4) to **insured authority bands**:
   low-risk reversible acts run free; money/licence/deletion acts run only when (a) confidence ≥
   calibrated threshold, (b) four-eyes approved, AND (c) inside the **insured aggregate**. Beyond:
   partner with an **Armilla/HSB-class affirmative AI policy** so the MD's actuator acts carry
   real-world indemnity — a guarantee no SaaS competitor can match.

5. **Authority control plane for actuators.** Issue Mr. Mwikila a **scoped, parameterized
   payment token** per tenant per actuator: bound by *merchant/wallet, amount ceiling, use-case,
   and TTL*. A B2C disbursement to a refiner is a different grant from a wage payout. Beyond:
   adopt the FIDO **agent-initiated-commerce** spec as it lands so grants are cryptographically
   verifiable end-to-end.

6. **Graceful actuator degradation as a feature.** A "Tanzania Rails Adapter" that tries
   direct API → aggregator → assisted-portal-with-four-eyes, and **always drives to confirmed
   completion** (the closed-loop fabric). Beyond: when IDRAS/TRA ship official APIs, hot-swap the
   adapter with zero change to the brain — the MD never knew the difference.

7. **The Quarterly Fiduciary Audit, auto-generated.** From the audit chain, produce a
   board-grade report: every autonomous act, outcome SLA attainment, exceptions, reversals,
   money moved, filings accepted. Beyond: a **regulator-facing read-only attestation endpoint**
   so Tume ya Madini / TRA can verify compliance posture without a site visit.

---

## 3. Our gaps (what HANDS must close)

Grounded in repo inspection. We have strong primitives; the gap is **packaging them into a
provable service operating model**, not building from zero.

**What we already have (the foundation is real):**
- `services/payments-ledger/src/providers/{mpesa,stripe}` — M-Pesa STK-push/webhook + Stripe;
  double-entry ledger via `LedgerService.post()`; `events/` outbox.
- `packages/central-intelligence/src/policy-gate/` + `__tests__/four-eye-approval*.test.ts` —
  four-eyes approval + tier-policy resolver already exist.
- `packages/ai-copilot/src/security/audit-hash-chain.ts` — the tamper-evident chain (§1.5).
- `packages/ai-copilot/src/autonomy/{autonomous-action-audit,autonomy-policy-service,guard,
  exception-inbox}.ts` — autonomy posture + per-act audit (reasoning/evidence/confidence/
  chainId) + exception inbox. This is most of §1.4 and §1.5 already.
- `services/{notifications,outbox-processor}` + `packages/document-studio/src/{esign,signing}` —
  comms + e-sign substrate.

**The gaps:**

1. **GAP-HANDS-1 · No outcome-SLA / outcome-pricing meter.** We have the ledger and the audit
   chain but **no concept of a billable, guaranteed OUTCOME** (royalty-settled, arrears-recovered,
   filing-accepted) with attainment tracking + auto-rebate. This is the core of the
   service-as-software model and it does not exist. (§1.1, §1.2)

2. **GAP-HANDS-2 · No Tanzania Rails Adapter beyond M-Pesa.** Only `mpesa` + `stripe` providers
   exist. **Airtel Money, Mixx-by-Yas/Tigo, HaloPesa, and the ClickPesa/PayIn aggregator path
   are absent**, and there is **no IDRAS/TRA/BRELA actuator** (even an assisted-portal one). The
   "does the work" promise is currently single-wallet. (§1.8)

3. **GAP-HANDS-3 · No agent authority control plane / scoped payment tokens.** Authority is
   enforced by RLS + policy-gate, but there is **no per-tenant, per-actuator scoped/TTL'd payment
   grant** (merchant/amount/use-case-bound). An agent that moves money needs authority control,
   not just access control. (§1.6)

4. **GAP-HANDS-4 · No portable Trust Receipt artifact.** The hash chain is internal; there is no
   **signed, human/insurer/regulator-readable receipt** per act, and nothing aligned to the
   emerging IETF agent-audit-trail format. The trust substrate isn't externalized as a product
   surface. (§1.5, beyond-today #3)

5. **GAP-HANDS-5 · No insurance/bonding integration or performance bond.** No affirmative-AI
   policy linkage, no insured-aggregate ceiling on autonomous money acts, no fee-clawback on
   missed SLA. Real-world risk transfer is the differentiator we have not started. (§1.7)

6. **GAP-HANDS-6 · No published Fiduciary Charter / delegation-of-authority matrix.** Autonomy
   defaults live in `autonomy/defaults.ts` but there is **no tenant-facing fiduciary statement**
   nor a regulator-facing attestation endpoint — the "AI firm" framing is unrealized. (§1.3,
   beyond-today #1, #7)

7. **GAP-HANDS-7 · Confidence thresholds are not calibrated/recalibrated.** §1.4's SOTA pattern
   (0.85 irreversible / 0.70 reversible, recalibrated against Expected Calibration Error after 30
   days to a target FP rate matched to reviewer capacity) is not implemented — thresholds appear
   static. This directly governs how aggressively the MD can act without a human. (§1.4)

8. **GAP-HANDS-8 · No outcome-SLA contract layer / liability boundary doc.** We enforce
   policy-gate technically, but there is no machine-readable **delegation-of-authority + escalation
   matrix** that mirrors the BPO-style contract (§1.2) and serves as the documented "reasonable
   safeguards" defense AB 316 rewards. (§1.2, §1.3)
