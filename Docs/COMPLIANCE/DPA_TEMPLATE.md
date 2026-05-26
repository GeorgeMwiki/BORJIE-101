# Data Processing Agreement — Template

> Template DPA between Borjie Ltd ("Processor") and the
> contracting tenant ("Controller"). Customise the bracketed
> sections per tenant. Reviewed by legal before counter-signature.
> Anchors: GDPR Art. 28, TZ PDPA 2022 Art. 28, CCPA service-provider
> definition.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| "Controller" | The tenant entity contracting with Borjie |
| "Processor" | Borjie Ltd |
| "Personal Data" | Any data relating to identified or identifiable natural persons processed under this DPA |
| "Sub-Processor" | A third party engaged by the Processor to process Personal Data |
| "Applicable Law" | GDPR (where applicable), TZ PDPA 2022, CCPA (where applicable), and any other privacy law applicable to the Controller's processing |

## 2. Subject matter & duration

| Field | Value |
|---|---|
| Subject matter | Property management SaaS services |
| Duration | Coterminous with the Main Service Agreement |
| Nature & purpose | As described in `Docs/COMPLIANCE/GDPR_ARTICLE_30.md` Activities 1-7 |
| Types of Personal Data | Identifiers, contact details, financial data, lease records, AI-conversation history |
| Categories of subjects | Property owners, customers/tenants, estate managers, staff |

## 3. Processor obligations

The Processor shall:

1. Process Personal Data only on documented instructions from the Controller.
2. Ensure persons authorised to process the Personal Data are under confidentiality obligation.
3. Take all measures required pursuant to GDPR Art. 32 / TZ PDPA Art. 25 (security of processing).
4. Engage sub-processors only with the Controller's general written authorisation (see § 6 below).
5. Assist the Controller with subject-rights requests via the DSAR endpoints documented in `Docs/COMPLIANCE/TZ_PDPA_2022.md`.
6. Assist the Controller in ensuring compliance with Art. 32-36 (security, breach notification, DPIA).
7. At the choice of the Controller, delete or return all Personal Data after the end of the provision of services.
8. Make available to the Controller all information necessary to demonstrate compliance.

## 4. Controller obligations

The Controller shall:

1. Provide processing instructions that are compatible with Applicable Law.
2. Hold a lawful basis for the processing it instructs.
3. Notify subjects of the processing through its own privacy notice.
4. Maintain its own RoPA (Art. 30) for the personal data it controls.

## 5. Security measures (Annex II)

The Processor implements (and continuously improves) the measures
listed in `Docs/COMPLIANCE/SOC2_CONTROLS.md` § CC6:

- Field-level encryption (AES-GCM-256 with per-tenant DEK)
- TLS in transit; HTTPS-only API gateway
- Audit hash-chain with daily verification
- RBAC + RLS + tenant isolation enforced at the kernel
- Four-eye approval on destructive operations
- Quarterly penetration test (planned wave-N)
- Incident response per `Docs/RUNBOOKS/incident-response.md`
- Sub-processor due-diligence per § 6

## 6. Sub-processors (Annex III)

The Controller hereby authorises the Processor's use of the sub-processors
listed in `Docs/COMPLIANCE/SUB_PROCESSORS.md` (or successor document).

The Processor shall:

1. Inform the Controller of any intended changes concerning the addition
   or replacement of sub-processors with **at least 30 days notice**.
2. Allow the Controller a reasonable period to object on legitimate grounds.
3. Impose on each sub-processor the same data-protection obligations as in
   this DPA via a binding back-to-back agreement.

## 7. International transfers

Where Personal Data is transferred outside the Controller's jurisdiction,
the Processor relies on:

- Adequacy decisions where available
- Standard Contractual Clauses (EU Commission 2021 SCCs)
- Tenant-specific consent for AI-provider transfers (Anthropic, OpenAI)

Transfer-impact assessments completed on request.

## 8. Personal data breach

The Processor shall notify the Controller without undue delay (and in
any event within **48 hours**) after becoming aware of a Personal Data
Breach. Notification shall include:

- Nature of the breach, including categories and approximate number of subjects
- Likely consequences
- Measures taken or proposed
- DPO contact for further information

Detailed procedure: `Docs/RUNBOOKS/audit-chain-verification.md` § "Notification chain".

## 9. Data subject rights

The Processor assists the Controller with:

| Right | Method |
|---|---|
| Access | DSAR endpoint, response within 30 days |
| Rectification | Self-serve profile-edit or DPO-mediated update |
| Erasure | RTBF endpoint, cascade per `tenant-offboarding-rtbf.md` |
| Portability | DSAR endpoint with `format=json` |
| Restriction / objection | DPO-mediated flag on the subject's record |

## 10. Audit rights

The Controller may audit the Processor's compliance with this DPA:

- Annually, at the Controller's expense
- With 30 days written notice (except for breach investigations)
- Subject to confidentiality and non-disruption of operations
- Standard auditor-evidence bundle delivered per `SOC2_CONTROLS.md`

Third-party audit reports (SOC 2 Type II) substitute for direct audit
where reasonable.

## 11. Liability & indemnity

Per the Main Service Agreement. Liability for processing breaches
allocated per Art. 82 GDPR / TZ PDPA equivalent.

## 12. Termination

On termination of the Main Service Agreement:

- All Personal Data returned to the Controller in machine-readable format, OR
- Deleted within 30 days (RTBF cascade), at the Controller's choice
- Certificate of destruction provided

## 13. Governing law & jurisdiction

Per the Main Service Agreement. Default: Tanzania law for TZ-resident
controllers; controller-jurisdiction law for non-TZ.

---

## Signature

| Party | Name | Title | Signature | Date |
|---|---|---|---|---|
| Controller | | | | |
| Processor (Borjie) | | | | |

## Annexes

- Annex I: Description of the processing (see § 2)
- Annex II: Security measures (see § 5)
- Annex III: Sub-processors (see `Docs/COMPLIANCE/SUB_PROCESSORS.md`)

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
