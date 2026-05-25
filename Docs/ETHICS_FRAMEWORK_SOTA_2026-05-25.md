# Ethics Framework — SOTA Research Notes (2026-05-25)

Research and authority trail behind `packages/ethics-framework`.
This file is the durable citation log so an auditor (regulator,
internal compliance, or future maintainer) can trace each line of the
package to a specific standard, statute, or peer-reviewed paper.

## Scope

The framework codifies the cross-cutting ethics surface that sits
above `@borjie/fairness-eval` (statistical fairness),
`@borjie/compliance-pack` (legal-control catalogs), and
`@borjie/bias-handling` (bias mitigation). Eight subsystems:

1. **Principles registry** — 12 codified principles
2. **Consent management** — append-only log + parental consent
3. **Vulnerable populations** — extra safeguards
4. **Right to explanation** — GDPR Art 22 + EU AI Act
5. **Dark-pattern detector** — Brignull 14-type taxonomy
6. **Surveillance consent** — cameras/sensors in rented units
7. **Accessibility** — WCAG 2.2 AA + Section 508
8. **Composition root** — `createEthicsFramework({ store, jurisdiction })`

## Authoritative sources (≥ 10)

1. **EU AI Act, Regulation (EU) 2024/1689** — published OJ 12 Jul
   2024. Article 9 (risk-management system across the lifecycle of
   high-risk AI). Article 13 (transparency obligations to deployers).
   Article 14 (effective human oversight: a natural person must be
   able to override or stop the system). Article 26 (deployers'
   obligations — input data quality, logging, monitoring). These
   provisions enter into force in tranches; high-risk obligations
   apply 24 months after entry-into-force.

2. **GDPR (Regulation EU 2016/679)** — Articles 12 (concise,
   intelligible, plain-language transparency), 13–14 (information at
   collection — direct and indirect), 22 (right NOT to be subject to
   solely automated decisions producing legal or similarly significant
   effects; lawful bases: explicit consent, contractual necessity,
   Member-State law authorising it). Recital 71 explicitly references
   the "right to obtain an explanation" of automated decisions.

3. **GDPR Article 8 — children's consent (EU 16, member-state floor
   13)**. Combined with Article 12's plain-language test and
   Article 7(4)'s coercion-bar, the bar for processing children's
   data is the highest in the EU regime.

4. **COPPA — 16 CFR Part 312 (US)**. Children under 13 must obtain
   verifiable parental consent for the collection or use of any
   personal information by online services directed at them or with
   actual knowledge of users under 13. Verification methods include
   signed forms, credit-card transactions, video conferencing, or
   government-ID checks (the FTC 2013 amendments expanded acceptable
   methods).

5. **POPIA Section 35 (Republic of South Africa)**. A child under 18
   requires the consent of a competent person (parent, guardian, or a
   court). Special rules apply when the data is processed by health
   professionals or in safeguarding contexts.

6. **WCAG 2.2 — W3C Recommendation, 5 Oct 2023**. Adds 9 success
   criteria over 2.1; the AA new ones we ship checks for are 2.4.7
   (focus visible), 2.5.7 (dragging movements), 2.5.8 (target size
   minimum), 3.2.6 (consistent help), 3.3.7 (redundant entry).
   Section 508 Refresh (29 CFR § 1194, Jan 2017) explicitly
   incorporates WCAG 2.0 AA by reference — US federal floor.

7. **IEEE Std 7000-2021 — Model Process for Addressing Ethical
   Concerns During System Design**. First IEEE ethics standard with
   process compliance. Requires stakeholder values elicitation +
   transparency log + value-realisation evaluation. Companion:
   IEEE P7001 (Transparency), P7002 (Privacy), P7003 (Algorithmic
   Bias).

8. **NIST AI Risk Management Framework 1.0 (Jan 2023)** + AI RMF
   Playbook. Four functions: GOVERN, MAP, MEASURE, MANAGE. We code
   evaluators for Govern 4.1 (named accountable owner per system) +
   Measure 2.11 (fairness + bias evaluation must be documented). The
   Generative AI Profile (NIST AI 600-1, Jul 2024) refines for LLMs.

9. **Asilomar AI Principles (Future of Life Institute, Jan 2017)** —
   23 principles. We ship evaluators for #6 (safety throughout
   operational lifetime) + #8 (judicial transparency — autonomous
   judicial involvement must yield an auditable explanation).

10. **Anthropic Responsible Scaling Policy (RSP, Sep 2023; updated
    Oct 2024)**. AI-Safety Level (ASL) framework — pre-deployment
    harm-elicitation evals (CBRN, autonomy, persuasion) gate
    deployment. Constitutional AI training (Bai et al., Anthropic,
    2022) is the training-time analogue.

11. **Microsoft Responsible AI Standard v2 (Jun 2022)**. Six goals:
    Accountability, Transparency, Fairness, Reliability & Safety,
    Privacy & Security, Inclusiveness. Goal F1 (allocation harms
    minimised across demographic groups) is the evaluator we
    instantiate.

12. **Google PAIR Guidebook (People + AI Research, 2019; updated
    2023)**. Patterns we encode: "Mental Models — set expectations"
    (AI badge on AI-generated decisions) + "Feedback & Control"
    (visible opt-out path).

13. **Harry Brignull, "Deceptive Design" (deceptive.design, 2010
    onward)** + **Mathur et al., "Dark Patterns at Scale: Findings
    from a Crawl of 11K Shopping Websites", CSCW 2019 (arXiv
    1907.07032)**. Source of the 14-category taxonomy we implement.

14. **EU Council Directive 2005/29/EC (Unfair Commercial Practices)
    + DSA Art. 25 (2024)**. Annex I lists practices that are unfair
    in all circumstances; DSA Art. 25 explicitly bans dark-pattern
    deployment by Very Large Online Platforms.

15. **FTC Click-to-Cancel Rule (2024)** + FTC Negative Option Rule.
    Cancellation must be at least as simple as the channel that was
    used to sign up — encoded in our `obstructionDetector` heuristic.

16. **NIST IR 8062 — An Introduction to Privacy Engineering and Risk
    Management in Federal Information Systems (Jan 2017)**. Three
    privacy properties: predictability, manageability, disassociability.

17. **Future of Privacy Forum (FPF) Camera-in-the-Home Guidelines
    (2020)**. Tenant-disclosure + opt-in + zones-of-privacy + audio
    rules — sourced for the surveillance-consent rule registry.

18. **18 USC § 2511 + state two-party-consent laws (12 US states
    incl. CA, FL, IL, MA, MD, MT, NH, PA, WA)**. Drives the audio-
    recorder opt-in requirement in the US-specific rules.

19. **Wachter, Mittelstadt, Russell, "Counterfactual Explanations
    Without Opening the Black Box", Harvard JLT 31.2 (2017)**.
    Foundation for the `requestExplanation()` counterfactual output —
    "if X had been Y, the decision would have flipped".

20. **TZ Land Act 1999 § 30 — special protection for elderly /
    widows; TZ Persons with Disabilities Act 2010 §§ 30–35; KE
    Rental Housing Act 2017; ZA Rental Housing Act 50 of 1999 § 4
    (no unfair discrimination); UG Persons with Disabilities Act
    2020; RW Law N°01/2007 (Rights of Persons with Disabilities); NG
    Discrimination Against Persons with Disabilities Act 2018; HUD
    Eviction Protection Program guidance (2022); ABA Tenant
    Vulnerability handbook (2021); VAWA Reauthorization Act 2022;
    Istanbul Convention (CoE 2011) Art. 18; 1951 Refugee Convention
    + 1967 Protocol; UNCRC 1989 Arts 3 + 16**. All anchor
    jurisdiction-specific safeguard rules in
    `vulnerable-populations/safeguard-rules.ts`.

21. **TZ Personal Data Protection Act 2022 § 25; KE Data Protection
    Act 2019 § 28 (CCTV notice + DPIA); UG Data Protection and
    Privacy Act 2019 § 8; RW Law 058/2021 Arts 27-28; NG NDPA 2023
    § 24; UK ICO CCTV Code of Practice (Jan 2023); CCPA + CPRA +
    Cal. Penal Code § 632**. Anchor the surveillance-consent
    disclosure rules.

## Design decisions traced to sources

| Decision | Source |
|---|---|
| Append-only consent log; withdraw is a new record with `granted:false` | GDPR Art 7(3) — withdrawal as easy as grant; auditability for breach-investigation |
| Re-consent triggers on (scope, version, jurisdiction) | GDPR Art 12 + 13 plain-language + new-purpose disclosure |
| Parental consent age table: COPPA 13 / EU 16 / TZ-KE-UG-RW-NG-ZA 18 / UK 13 | Each jurisdiction's children's-consent floor; we never go below the local statute |
| `verifyParent` callback is required, not optional | COPPA "verifiable" parental consent — bare assertion is not sufficient |
| Vulnerable-population safeguards are per-(factor, jurisdiction) with GLOBAL fallback | UN-level commitments are universal; statutory uplift is jurisdiction-specific |
| `getVulnerabilitySafeguards()` deduplicates by `kind`, jurisdiction-specific wins | Specificity rule from EU AI Act Recital 27 |
| `recordAutomatedDecision()` always logged, even when human-reviewed | EU AI Act Art 26(6) logging duty; GDPR Art 30 records of processing |
| Counterfactual surfaces highest-weight numeric input | Wachter et al. 2017 — minimal-cost flip |
| `optOutOfAutomation()` is per-(subject, scope), not blanket | GDPR Art 22 right is per-decision; scope-level opt-out approximates without coercing platform-wide manual review |
| Brignull taxonomy = 14 closed enum types | Brignull 2010 + Mathur et al. 2019 (Mathur consolidates Brignull into the 14 patterns shipped) |
| Indoor-camera `always-on` recording is banned in every jurisdiction | FPF guideline + GDPR Recital 49 (proportionality) — we exceed any single statute |
| Outdoor cameras do NOT require tenant opt-in (signage suffices) | EU CCTV legitimate interest (Art 6(1)(f)) + EDPB Guidelines 3/2019 |
| Audio recorders require opt-in in US (federal floor) | 12 two-party-consent states are decisive — opt-in covers all |
| Surveillance consent does NOT carry across tenancies | NIST IR 8062 — manageability requires the new tenant has the live consent record |
| WCAG 2.2 AA SC 2.5.7 (dragging) requires a single-pointer alternative | WCAG 2.2 (Oct 2023) text; covered by `draggingMovementsCheck` |
| WCAG 2.2 AA SC 2.5.8 (target size) minimum is 24×24 CSS px | WCAG 2.2 text; `targetSizeCheck` heuristic |

## Jurisdiction coverage matrix

| Jurisdiction | Age of data consent | Vulnerable safeguards | Surveillance rules | Notes |
|---|---|---|---|---|
| GLOBAL | 18 (default cap) | UN + ABA + Istanbul Convention | — | catch-all |
| EU | 16 (Art 8) | + EU AI Act + GDPR Art 22 | full | UK GDPR mirrors |
| UK | 13 (AADC) | inherits EU | full | UK GDPR + Tenant Fees Act |
| US | 13 (COPPA) | FHA + ADA + VAWA | + audio opt-in | federal floor |
| US-CA | 13 | CCPA + CalECPA | + Penal Code § 632 audio | two-party state |
| ZA | 18 (POPIA § 35) | RHA + PWDA-equivalent | POPIA s.18 | |
| TZ | 18 (PDPA 2022 § 28) | Land Act 1999 § 30 + PWDA 2010 | PDPA § 25 | |
| KE | 18 (DPA 2019 § 33) | Rental Housing Act 2017 + PWDA 2003 | DPA § 28 CCTV + DPIA | |
| UG | 18 | Landlord & Tenant Act 2022 + PWDA 2020 | DPP Act § 8 + Reg. 22 | |
| RW | 18 | Law N°01/2007 PWDA | Law 058/2021 Arts 27-28 | |
| NG | 18 (NDPA 2023 § 31) | PWDA 2018 | NDPA 2023 § 24 | |

## Out of scope

- Statistical fairness — `@borjie/fairness-eval`
- Legal control catalogs — `@borjie/compliance-pack`
- Bias mitigation algorithms — `@borjie/bias-handling`
- Storage backends — implementations live in `@borjie/database`
  via the `EthicsStore` port
- Live model deployment + harm-eval execution — `evals/`

## Test surface (99 tests)

- `principles-registry.test.ts` — 12 principles, source coverage, per-
  jurisdiction filtering, GDPR/Anthropic/Google evaluators (11 tests)
- `consent.test.ts` — age-of-consent table, round-trip, version-bump,
  jurisdiction-change, parental flows (TZ/KE/EU/US) (21 tests)
- `index.test.ts` — composition root sanity (2 tests)
- `vulnerable-populations.test.ts` — per-factor and per-jurisdiction
  rules, dedupe (12 tests)
- `right-to-explanation.test.ts` — record + explain + opt-out + error
  paths (8 tests)
- `dark-patterns.test.ts` — taxonomy size + each of 14 detectors +
  clean inputs (18 tests)
- `surveillance-consent.test.ts` — registry coverage, register +
  consent + validate, tenancy-change, banned policies (10 tests)
- `accessibility.test.ts` — 16-check registry + pass/fail per SC + score
  computation (15 tests)
