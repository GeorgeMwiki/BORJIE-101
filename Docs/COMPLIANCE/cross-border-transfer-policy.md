# Cross-Border Data Transfer Policy

_Applies to: GDPR Chapter V (Arts. 44–50), PDPA TZ s. 51–54, DPA KE s. 48–50,
NDPA NG s. 41–44._

## Current footprint

| Tenant jurisdiction | Primary storage (`awsRegionDefault`) | Cross-border? |
|---|---|---|
| TZ | eu-west-1 (Ireland) | **Yes** — TZ → EU |
| KE | eu-west-1 (Ireland) | **Yes** — KE → EU |
| NG | af-south-1 (Cape Town, ZA) | **Yes** — NG → ZA |
| EU | eu-west-1 (Ireland) | No (within EEA) |

Every cross-border transfer needs:
1. A valid Article 46 / s. 51(2)(d) / s. 48(1)(b) / s. 41(1)(b) **mechanism** (SCC, BCR, adequacy)
2. A **Transfer Impact Assessment** (Schrems II — addresses surveillance-law risks)
3. Recorded **consent** if relied upon (Art. 49 / s. 51(2)(b))

## Mechanisms in use

### Standard Contractual Clauses (SCC)

The EU Commission's SCC 2021/914 modules cover:
- **Module 2** — Controller (BORJIE EU) → Processor (BORJIE TZ ops)
- **Module 3** — Processor (AWS Ireland) → Sub-processor (AWS Tanzania, when GA)

BORJIE's master SCC is signed between:
- BORJIE Ltd (EU representative office)
- BORJIE Tanzania Ltd (data importer)
- BORJIE Kenya Ltd (data importer)
- BORJIE Nigeria Ltd (data importer)

Annexes (per Module 2):
- Annex I.A — Parties (above)
- Annex I.B — Description of transfer (purpose, categories, recipients)
- Annex II — Technical & organisational measures (TOMs)
- Annex III — Sub-processors list

The SCC text + signed annexes live in `<LEGAL_REPO>/scc/`.

### Adequacy decisions

| Country | Adequacy regulator | Status |
|---|---|---|
| EU adequacy list | EU Commission | UK, CH, IL, JP, KR (no TZ/KE/NG) |
| TZ PDPC adequacy list | PDPC | None declared as of 2026-05 |
| KE adequacy list | Cabinet Secretary | None declared |
| NG adequacy list | NDPC | Pending NDPC framework publication |

BORJIE **cannot rely** on adequacy for TZ/KE/NG transfers today. SCC is
the operative mechanism.

### Binding Corporate Rules (BCR)

Not yet in place. Roadmap item for 2027 when entity headcount + regulator
relationships warrant the (~12-month) approval process.

### Article 49 derogations

Used only for narrow cases:
- Marketplace cross-border listings — Art. 49(1)(a) explicit consent
- Lease cross-border contracts (rare) — Art. 49(1)(b) contract performance

## Transfer Impact Assessment (TIA)

Schrems II (CJEU C-311/18) requires controllers to assess whether the
destination country's surveillance law overrides the SCC protections. The TIA
covers:

1. **Surveillance-law landscape** of the recipient country
2. **Probable access** to the data by foreign public authorities
3. **Adequacy of safeguards** to mitigate any disproportionate access
4. **Supplementary measures** (encryption, pseudonymisation, contractual
   warranties) when SCC alone is insufficient

BORJIE's TIA template lives in this directory (see `dpia-template.md` —
the DPIA covers the TIA as one section).

### Per-destination TIA summary

#### EU → TZ

- Surveillance law: Cybercrimes Act 2015; Electronic and Postal Communications Act 2010
- Court oversight: Required for substantive access; emergency exception
- Supplementary measures BORJIE applies:
  - Field-level encryption at rest (DEK held in EU KMS, not TZ)
  - In-transit TLS 1.3 with client-cert pinning
  - Pseudonymisation of audit subject identifiers
  - No-back-door warranty in DPA with TZ operations entity

#### EU → KE

- Surveillance law: National Intelligence Service Act 2012; Computer Misuse & Cybercrimes Act 2018
- Court oversight: Required (Magistrate's warrant)
- Supplementary measures: same as EU → TZ

#### EU → NG (and via af-south-1)

- Nigerian Communications Act 2003; Cybercrimes Act 2015
- Court oversight: Required for substantive access
- Note: NG primary storage is in ZA (af-south-1). ZA POPIA + RICA 2002
  governs that leg. SCC modules cover both hops.

## Operational obligations

1. **Sub-processor list** — maintained as Annex III of SCC. Update on
   change ≥10 days notice to data subject (GDPR Art. 28(2))
2. **DPA cascading** — every sub-processor binds to equivalent terms
3. **Annual TIA review** — re-assess surveillance-law landscape
4. **Audit rights** — controller has audit rights on every processor
   (typically delegated via SOC 2 / ISO 27001 attestations)

## When to STOP a cross-border transfer

The DPO must immediately suspend a transfer if:
- Recipient country issues a surveillance-law change that breaks the TIA
- A regulator issues a stop order (e.g., PDPC binding direction)
- A breach in the recipient demonstrates safeguards are inadequate
- Adequacy decision is invalidated (Schrems-style ruling)

Suspension procedure:
1. Block new writes to the destination via feature flag (`disable_xborder_<dest>`)
2. Drain in-flight transfers; let durable workflows complete with circuit-breaker
3. Inform affected data subjects
4. File controller notification with the export-jurisdiction regulator

## Documentation

- SCC + annexes: `<LEGAL_REPO>/scc/`
- TIA reports: `<LEGAL_REPO>/tia/`
- DPA / processor agreements: `<LEGAL_REPO>/dpa/`
- This policy + DPIA template: this directory
