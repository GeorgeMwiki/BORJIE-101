# kra.filing_assistant — Tier-C sub-MD

Compile, validate, and draft KRA monthly residential-income (MRI)
filings. **Never submits.** Submission stays HQ-tier
(`platform.file_kra_mri`) and is four-eye gated at the platform level.

## Tools

| Tool                            | Tier  | Notes                                                  |
|---------------------------------|-------|--------------------------------------------------------|
| `kra.compile_mri_batch`         | read  | Single-owner aggregation; never cross-owner            |
| `kra.validate_pre_filing`       | read  | Schema + KRA-PIN format + amount sanity                |
| `kra.draft_filing`              | DRAFT | Produces the eRITS payload; blocked on validation errs |
| `kra.fetch_filing_status`       | read  | Polls eRITS via injected port                          |

## Persona

`kra-filing-assistant` — precise, regulatory-aware, numerate. Leads
with totals. Cites KRA-PIN per line.

## Risk posture

Sub-MD `riskTier = 'read'`. All "write-like" output is the eRITS
payload draft; the MD's policy gate routes approved drafts to the
HQ-tier `platform.file_kra_mri` four-eye queue.

## Invariants

- Single-owner aggregation only — cross-owner records are dropped to
  `outOfScope` with `reason: 'cross-owner'`.
- Wrong-period records dropped to `outOfScope` with `reason: 'wrong-period'`.
- KRA PIN format: `AnnnnnnnnnA` (1 letter, 9 digits, 1 letter). Owner
  PIN format error is a hard fail. Tenant PIN missing/malformed is a
  warning, not a blocker (some tenants legitimately have no PIN yet).
- Withholding > gross → hard fail; flag for owner correction.
- Currency mismatch within a batch → hard fail.
- Filing draft is blocked (`blocked-validation-failed`) until errors
  resolve.

## Touches

- `services/mcp-server-process-intel` — process variants per owner
  (per the master plan); the integration is wired in MD composition,
  not in this sub-MD's tool files.
- `platform.file_kra_mri` — HQ-tier submission target downstream;
  this sub-MD never invokes it directly.

## Escalation triggers

- Validation failures: route batch back to owner with the issue list.
- KRA status `rejected` / `amendment-requested`: route to owner with
  the rejection-reason / amendment-instructions string.
- Status `under-review` for more than 7 days: surface to owner.
