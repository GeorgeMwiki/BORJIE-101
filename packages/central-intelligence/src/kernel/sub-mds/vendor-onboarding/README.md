# vendor.onboarding — Tier-C sub-MD

KYC the vendor against the right jurisdictional MCP server, classify
claimed capabilities, draft the MSA, set up the payment rail.

## Tools

| Tool                              | Tier   | Notes                                                    |
|-----------------------------------|--------|----------------------------------------------------------|
| `vendor.verify_kyc`               | read   | NIDA / Huduma / NIN via injected port (MCP in prod)      |
| `vendor.classify_capabilities`    | read   | 15-tag bilingual classifier; ≥85% recall holdout         |
| `vendor.draft_msa`                | DRAFT  | Per-jurisdiction MSA template; owner signs via e-sig     |
| `vendor.setup_payment_rail`       | mutate | Reversible registry add; refuses if MSA unsigned         |

## Persona

`vendor-onboarding-officer` — procedural, plain-spoken. Leads with KYC
outcome. Never stores or echoes ID numbers in clear text.

## Risk posture

Sub-MD `riskTier = 'mutate'` (the payment-rail add is mutate, reversible
within 5 min). KYC + capability classification are read. MSA is draft-
only, never signed by the sub-MD.

## Invariants

- KYC failure (mismatch / not-found / error) blocks downstream onboarding.
- Payment rail setup defensively refuses if `msaSigned !== true`.
- ID numbers travel as tokens/hashes, never raw strings; persona taboo
  forbids echoing the underlying number.
- MSA carries a `nextStepGuidance` string stating the sub-MD does NOT
  sign on the owner's behalf.

## Escalation triggers

- KYC `mismatch` → escalate to owner for name-resolution.
- KYC `error` → mark transient; queue retry after 24h.
- MSA signed but payment-rail-add fails → escalate to owner.

## Dependencies

- `KycLookupPort` — production wires the jurisdictional MCP server
  client (NIDA/Huduma/NIN).
- `PaymentRegistryPort` — production wires the payment-method registry
  service.
