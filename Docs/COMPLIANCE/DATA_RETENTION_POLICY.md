# Data Retention Policy — Borjie

> Companion to `Docs/COMPLIANCE/SOTA_DATA_PROTECTION_2026.md`.
> Author: Mr. Mwikila, SEC-3. Last review: 2026-05-26.
>
> Enforced via the `retention_policies` table in migration 0053. The
> retention-runner job (`@borjie/data-protection` →
> `src/retention/retention-runner.ts`) wakes up nightly, computes
> "rows older than `retention_days` AND not under a legal hold AND
> not under an open RTBF retain-marker", and purges them per the
> action defined for the class.

---

## 1. Policy structure

A retention policy row carries:

```
{
  tenant_id:             text       -- per-tenant override possible
  class:                 text       -- one of the eight classifications
  retention_days:        integer    -- inclusive window from row creation
  exception_categories:  jsonb      -- list of category strings exempt
                                    --   from the default purge
  last_purge_at:         timestamptz
  audit_hash:            text       -- hash-chained
}
```

The `(tenant_id, class)` pair is UNIQUE — exactly one policy per
tenant per class. Defaults are seeded on tenant creation by the
onboarding worker. Tenants may extend (never shorten below statutory
minimums) via the DPO console.

---

## 2. Per-class retention table

| Class | Retention window | Purge action | Statutory minimum | Statutory ceiling | Notes |
|-------|-------------------|--------------|--------------------|---------------------|-------|
| `public` | 10 y | delete | none | none | Documentary value retains marketing assets. |
| `internal` | 2 y | delete | none | none | Telemetry, build metadata. |
| `confidential` | 2 y | delete | none | none | Internal cost models, junior debate transcripts. |
| `restricted` | 2 y | delete | none | none | Production volumes; mining-domain operational. |
| `critical` | 7 y | crypto-shred + audit-retain | Tanzania TRA s. 50: 5 y | 7 y operational cap | Sovereign decisions, kill-switch events. Audit-chain row kept indefinitely; payload shredded at +7 y. |
| `pii` | 12 m default | delete + RTBF cascade | none (DPA s. 26(1)(c) = "no longer than necessary") | None binding; 12 m chosen as good practice | Tenants can extend to 24 m max. |
| `phi` | 7 y | crypto-shred + audit-retain | Workforce medical: TZ Occupational Safety Act s. 17 = 5 y | 7 y operational cap | Hearing-loss audiometry, silicosis screening. |
| `financial` | 7 y | retain (legal hold) | TZ Tax Administration Act s. 35 = 5 y | 7 y operational cap | Cannot be purged on RTBF — explicit refusal with legal-basis citation. |

**Notes**

- `crypto-shred` = delete the wrapped DEK (envelope encryption renders
  the ciphertext irrecoverable). The audit-chain row remains so the
  shred event is verifiable.
- `RTBF cascade` = standard delete + cascade plan per
  `src/rtbf/cascade-planner.ts`. Cross-tenant references resolved via
  the token-replacement rule (subject identifier replaced with a
  stable hash).
- The Tanzania DPA does not set a fixed retention ceiling — s. 26(1)(c)
  obliges processors to keep data "no longer than necessary". 12 months
  for general PII is our reasoned default. Tenants who need shorter
  windows (e.g., 90 days for ephemeral support tickets) configure
  via the DPO console.

---

## 3. Exception categories (legal hold)

`exception_categories` is a JSON array of category strings. A row whose
`category` matches any entry in its tenant's policy is excluded from the
nightly purge.

Canonical categories:

- `"litigation_hold"` — active or anticipated litigation. Set by legal
  team via the DPO console. Surveyed quarterly.
- `"regulatory_investigation"` — open PDPC / ODPC / NDPC / DPA enquiry.
- `"tax_obligation"` — TRA / KRA / FIRS audit period.
- `"safety_incident"` — open OSHA / safety-board investigation.
- `"contract_active"` — contractual retention obligation (e.g., DSU
  agreements with off-takers).
- `"rtbf_blocker"` — set by the RTBF orchestrator when a subject has
  requested erasure but a blocker (unpaid invoice, court order) applies.

A row tagged with `"rtbf_blocker"` is retained until the blocker is
cleared, at which point the RTBF orchestrator re-runs the cascade.

---

## 4. Purge schedule

The retention-runner runs **nightly at 02:00 local-tenant-time** (so a
KE tenant gets a 02:00 EAT purge, an EU tenant gets a 02:00 CET purge).
Per-tenant scheduling avoids the all-tenants-at-once load on Postgres.

The runner is **incremental**:

1. Query `retention_policies` for the current tenant.
2. For each `(class, retention_days)` pair, find rows older than
   `now() - retention_days` whose `category` is not in
   `exception_categories`.
3. For each such row, dispatch the purge action (`delete` /
   `crypto-shred` / `retain`).
4. Write a `data_purge_audit` row capturing the count and class
   purged (hash-chained).
5. Update `retention_policies.last_purge_at`.

The runner is idempotent — re-running it on the same night purges
nothing (every candidate already gone). If a purge step fails
mid-batch, the next night's run catches up.

---

## 5. Audit + verification

Every purge writes a row to `audit_events` with:

- `category = 'DATA_PURGE'`
- `actor_type = 'system'`
- `actor_id = 'retention-runner'`
- `target_type = '<table_name>'`
- `target_id = '<purge_batch_id>'`
- `outcome = 'SUCCESS' | 'FAILURE'`
- `metadata = { count: N, class: '<class>', purge_action: '...' }`

The hash-chain over `audit_events` provides tamper-evident proof that
no purges were silently skipped. The CI workflow
`data-protection-gate.yml` cross-references `retention_policies`
against the eight-class lattice and fails the build if any tenant is
missing a policy for any class.

---

## 6. Tenant DPO console controls

The DPO console exposes:

- Per-class retention slider (within statutory bounds).
- Exception-category editor.
- "Pause purge for class X" emergency switch (audit-logged).
- "Force purge now" command (also audit-logged; rate-limited to one
  per day per tenant per class).

The slider hard-blocks values *below* the statutory minimum for that
class (e.g., trying to set `financial` to 1 year is rejected with a
citation to TZ Tax Administration Act s. 35).

---

## 7. Cross-jurisdiction overlay

When a tenant operates across multiple jurisdictions (TZ + KE + EU),
the *most restrictive* retention rule wins for each class. The
overlay logic is:

```
retention_days = min(
  TZ_default(class),
  KE_default(class),
  EU_default(class),
  tenant_override(class),
)
```

The override cannot push *below* the floor (the maximum of statutory
minimums across the active jurisdictions). Cross-jurisdiction status
is read from `tenant_metadata.active_jurisdictions`.

---

## 8. Worked example — a workforce hearing-screening record

A worker on a tenant's site undergoes an annual audiometry exam. The
resulting row in `workforce_medical_screenings` carries:

- `tenant_id` = the mining company
- `worker_id` = the individual operator (PII)
- `exam_date` = 2026-01-15
- `audiogram_blob_ref` = pointer to the encrypted PDF in object-store
- `notes` = clinical interpretation (PHI)
- `severity` = clinical category (PHI)

Classification: the row is tagged `phi` (clinical content dominates).
`retention_days` for `phi` is 7 y. The statutory floor is the TZ
Occupational Safety and Health Act s. 17 — 5 years. The tenant cannot
push retention below 5 years; they may extend up to 7 y (the
operational cap).

On 2033-01-15 (or sooner if a `litigation_hold` clears), the runner:

1. Marks the row for crypto-shred.
2. Calls `key-manager.deleteWrappedDek(row.wrappedDekRef)` — the
   wrapped DEK is removed from the platform key store (or, for HYOK
   tenants, an alias delete is dispatched to the customer KMS).
3. Writes an `audit_events` row recording the shred with the original
   row hash.
4. Updates `data_classifications.audit_hash` for the row to mark the
   final state.

The encrypted PDF stays in the object-store snapshot until the snapshot
itself expires (typically 30 d), but it is mathematically unrecoverable
the moment the DEK is gone.

If a worker invokes RTBF before the 5-year minimum elapses, the
orchestrator refuses with the citation. The DPO console surfaces the
refusal to the worker with the appeal path.

---

## 9. Worked example — a customer support ticket

A buyer messages support about a marketplace dispute. The ticket row:

- `tenant_id` = the buyer's parent organisation
- `subject_id` = the buyer (PII)
- `body` = free-text from the buyer
- `email_thread` = inbound + outbound emails

Classification: `pii` (free-text may contain identifiers).
`retention_days` for `pii` is 12 m default. The tenant configures a
90-day window for support tickets (well below the 12 m default but
above the implicit zero floor).

On day 91 after creation, the runner:

1. Deletes the ticket row.
2. Cascade-deletes referenced attachments.
3. Replaces references in `audit_events` for downstream rows that
   point to this ticket with the stable subject-token (preserves
   referential integrity for analytics without leaving PII behind).

If the buyer invokes RTBF on day 30, the cascade runs immediately and
the 90-day clock is moot for this row.

---

## 10. Operational metrics

The runner emits per-night metrics to OpenTelemetry:

- `data_retention.purged_rows{class, tenant}` — counter.
- `data_retention.purge_duration_ms{class, tenant}` — histogram.
- `data_retention.skipped_legal_hold{tenant}` — counter.
- `data_retention.failed_rows{class, tenant, reason}` — counter.

The DPO console surfaces these on the privacy dashboard. The on-call
SRE pages on `data_retention.failed_rows > 0` for three consecutive
nights, which usually signals a schema-drift between the
classification table and the live data.

---

## 11. Word-count check

Target ≈ 1500 words. Verified at commit time via `wc -w`.

— *Mr. Mwikila*, SEC-3, Borjie Sovereign Security Council, 2026-05-26.
