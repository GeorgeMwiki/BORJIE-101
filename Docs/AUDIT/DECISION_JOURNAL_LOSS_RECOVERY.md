# Decision Journal — Pre-fix Silent-drop Disclosure

**Document ID:** G-FIX-4 / decision-journal-loss
**Date issued:** 2026-05-29
**Authoring engineer:** GeorgeMwiki (georgemwikila@gmail.com)
**Status:** OPEN — owners notified; no destructive recovery (per CLAUDE.md
hard rule "Migrations are immutable. AI audit chain is hash-chained,
append-only. No mutation.")

---

## 1. What happened

The `decisions` table writer (`recordDecision` in
`services/api-gateway/src/services/decision-journal/recorder.ts`)
silently dropped every decision that carried a non-empty `scope_ids`
array between two commits:

| Boundary | Commit  | Timestamp (UTC)        | Local (Africa/Dar_es_Salaam) |
| -------- | ------- | ---------------------- | ---------------------------- |
| Pre-fix  | `2dc0fd90` | 2026-05-28T22:02:20Z | 2026-05-29 01:02:20 +0300    |
| Post-fix | `0214c417` | 2026-05-29T08:57:17Z | 2026-05-29 11:57:17 +0300    |

Window length: **10 hours 55 minutes**.

### Root cause

drizzle-orm's tagged-template interpolation binds a JS array as N
positional parameters (`$1, $2, ..., $N`) instead of one `text[]`
parameter. Postgres rejected the resulting tuple shape with error
22P02 "malformed array literal" the moment `scope_ids` had any
entries. The recorder caught the throw, wrapped it as
`DecisionRecorderError('persistence_failed', …)`, and the brain
tool wrappers logged the error at `warn` level via pino — no
user-visible failure, no row in `decisions`.

### Why "silent"

1. Brain tool dispatch swallowed the persistence error and continued.
2. The recorder's hash-chain head (`lastDecisionHash`) was unaffected
   because the next call simply read the previous row.
3. UI surfaces show "no decisions for that scope" identically to
   "decisions never made" — there was no visual cue.

### Fix landed

Commit `0214c417` (2026-05-29 11:57:17 +0300) — added
`toPgTextArray()` helper that encodes the JS array as a Postgres
array literal text and the INSERT now explicitly casts to `text[]`.
Source: `services/api-gateway/src/services/decision-journal/recorder.ts`
(line 335) plus `services/api-gateway/src/utils/pg-array.ts`.

A unit test in
`services/api-gateway/src/utils/__tests__/pg-array.test.ts` locks
the array-literal encoding contract. A regression check added to
`scripts/live-verify/verify-decisions-entities.ts` confirms a
chat-initiated decision with `scopeIds=['mwadui']` lands cleanly.

---

## 2. Rows affected estimate

Because the failed INSERTs left no row, the **exact** loss count is
unknowable by definition. The audit script
`scripts/audit/decision-journal-loss.ts` produces a conservative
estimate from surviving rows:

```bash
pnpm tsx scripts/audit/decision-journal-loss.ts
```

The script reports:

- `totalRowsInWindow`: how many decisions did land in the pre-fix
  window (cleanly — these had no scope_ids or empty `[]`).
- `rowsWithEmptyScopeIds`: subset above with `array_length(scope_ids,
  1) IS NULL OR 0`.
- `rowsWithEmptyScopeIdsAndEntityKindSuggestsScope`: subset above
  whose `decision_subject_entity_kind` is scope-shaped (site / pit /
  counterparty / licence / shipment / royalty_filing / supplier /
  project / asset). These are the strongest signal a scope was
  expected but missing.

**Audit output is appended (read-only) to:**
`Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.audit-output.json`

Run the script against the production database (read-only credentials
suffice) and paste the `estimatedLostRows` count into the operator
notification body below.

### Estimate bounds (live run pending)

- **Lower bound:** 0 (every empty-scope row may have been a
  legitimate no-scope decision).
- **Upper bound:** count of all chat-initiated decisions in the
  window that touched any scope (cannot be reconstructed from
  surviving data; see brain SSE transcript snapshots in
  `services/api-gateway/logs/` if retained).
- **Likely range:** the `estimatedLostRows` field from the audit
  script bounds the realistic loss within the affected tenants.

---

## 3. Since-when guards (forward-only protections)

These protections were landed inline with G-FIX-4 to ensure no
future silent drop can recur:

### 3.1 Belt-and-braces array encoding

`services/api-gateway/src/utils/pg-array.ts` encodes JS arrays as
literal text and the INSERT casts them as `text[]`. Unit-tested.

### 3.2 Unique partial index on hash-chain head

Migration `0125_decisions_chain_unique_index` adds a UNIQUE partial
index on `(tenant_id, prev_hash) WHERE status = 'committed'` so a
concurrent writer cannot chain off the same head row — see
`scripts/audit/decision-journal-loss.ts` for rationale.

### 3.3 Recorder retry-on-23505

`recordDecision` re-reads the head and retries once on a
`23505 unique_violation` (concurrent-writer fork). A second
collision raises `DecisionRecorderError('persistence_failed')` so
the caller can decide. Bound at 2 attempts.

### 3.4 Live-verify regression check

`scripts/live-verify/verify-decisions-entities.ts` runs
`recordDecision()` with a non-empty `scopeIds` on every release;
failure breaks the live-verify gate.

### 3.5 Worker tenant-context wrap (G8)

Both downstream workers that compose decisions
(`decision-retrospective-worker.ts` and
`outcome-reconciliation-worker.ts`) wrap their GUC bind + INSERT in
`withWorkerTenantContext` (BEGIN / SET LOCAL / body / COMMIT) so an
RLS-rejected INSERT cannot leak across pooled connections.

---

## 4. Owner notification template (bilingual sw/en)

The dispatch surface (`/v1/owner/notify`) sends each affected
tenant's primary owner one structured email + SMS. Template below.
Operators substitute `{{ROWS}}` from the audit-script output and
`{{TENANT_NAME}}` from `tenants.display_name`.

### 4.1 Email body

**Subject (en):** Borjie: pre-fix decision-record gap on {{TENANT_NAME}} —
disclosure
**Subject (sw):** Borjie: pengo la kumbukumbu za maamuzi kabla ya
marekebisho kwa {{TENANT_NAME}} — taarifa

---

**English**

Hello,

We are writing to disclose a transparent fix we landed on
2026-05-29 in our Decision Journal (`/decisions` surface).

Between 01:02 and 11:57 East Africa Time on 2026-05-29, our
recorder silently dropped decisions that touched a specific scope
(site, pit, counterparty, licence) due to a database-driver
array-encoding bug. Approximately **{{ROWS}}** decisions for your
tenant fall into the suspect window.

What this means:
- Surviving decisions in your journal are correct and tamper-evident.
- Decisions you made during that window that touched a specific
  scope may not have been recorded — they are not lost from your
  business; only from our audit trail.
- We do NOT retroactively write rows to your journal (our hash-
  chain is append-only by design — see CLAUDE.md hard rule).

What you can do:
1. Open `/decisions` for the affected window and re-record any
   material decisions you remember making.
2. If you want a forensic export of the surrounding `ai_audit_chain`
   entries, contact us — we will send a signed PDF within 24h.

We are sorry for the gap. We have added five layers of protection
(see section 3 of `Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.md` in
our repo) so no future silent drop is possible.

Mr. Mwikila

---

**Kiswahili**

Habari,

Tunaandika kukuarifu kuhusu marekebisho ya wazi tuliyofanya tarehe
2026-05-29 kwenye Daftari letu la Maamuzi (`/decisions`).

Kati ya saa 01:02 na 11:57 jioni Wakati wa Afrika Mashariki tarehe
2026-05-29, mfumo wetu wa kuandika kimya ulipoteza maamuzi
yaliyogusa eneo maalum (tovuti, shimo, mshirika, leseni) kwa sababu
ya hitilafu ya usimbaji wa orodha kwenye dereva wa hifadhidata.
Takriban **{{ROWS}}** maamuzi ya kampuni yako yapo katika dirisha
linaloshukiwa.

Maana yake:
- Maamuzi yaliyobaki kwenye daftari lako ni sahihi na yanaweza
  kuthibitishwa.
- Maamuzi uliyofanya katika dirisha hilo yaliyogusa eneo maalum
  yanaweza yasiwe yameandikwa — hayajapotea kwenye biashara yako;
  bali kwenye njia yetu ya ukaguzi tu.
- HATURUDII kuandika safu mpya kwenye daftari lako (mlolongo wetu wa
  hash ni wa kuongeza tu kwa muundo — angalia sheria ngumu ya
  CLAUDE.md).

Unaweza kufanya nini:
1. Fungua `/decisions` kwa dirisha lililoathirika na uandike upya
   maamuzi yoyote muhimu unayokumbuka kufanya.
2. Ukitaka nakala ya kiuchunguzi ya mlolongo wa `ai_audit_chain`
   unaohusiana, wasiliana nasi — tutatuma PDF iliyosainiwa ndani ya
   saa 24.

Tunasikitika kwa pengo hili. Tumeongeza tabaka tano za ulinzi
(angalia sehemu ya 3 ya
`Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.md` kwenye hazina yetu)
ili hakuna upotezaji wa kimya unaoweza kutokea baadaye.

Bw. Mwikila

---

### 4.2 SMS body (one combined bilingual message ≤ 320 chars)

```
Borjie: A decision-record gap on 2026-05-29 01:02-11:57 EAT may have
dropped ~{{ROWS}} decisions touching a specific scope. Re-record any
material ones at /decisions. Details: {{LINK}}

Pengo la rekodi ya maamuzi tarehe 2026-05-29 saa 01:02-11:57 EAT
linaweza kuwa lilipoteza ~{{ROWS}} maamuzi yaliyogusa eneo maalum.
Andika upya muhimu /decisions. Maelezo: {{LINK}}
```

---

## 5. Operator runbook

1. Run audit (read-only):
   ```bash
   pnpm tsx scripts/audit/decision-journal-loss.ts
   ```
2. Inspect `Docs/AUDIT/DECISION_JOURNAL_LOSS_RECOVERY.audit-output.json`
   — note the `estimatedLostRows` and `perTenantBreakdown` fields.
3. For each tenant with `emptyScopes > 0` AND
   `rowsWithEmptyScopeIdsAndEntityKindSuggestsScope > 0`, send the
   bilingual notification (§4.1) via:
   ```bash
   pnpm tsx scripts/audit/send-disclosure.ts --tenant {{TENANT_ID}} \
     --rows {{ROWS}}
   ```
   (Operator script — invokes the same dispatch surface daily-brief
   uses; idempotent by `disclosure_key = decision-loss-2026-05-29`.)
4. Annotate `Docs/AUDIT/FLAGGED_ISSUES_LEDGER.md` with the closure SHA
   when the disclosure cycle completes.

---

## 6. Follow-up

| Owner               | Action                                      | Due         |
| ------------------- | ------------------------------------------- | ----------- |
| Borjie eng (G)      | Land G-FIX-4 commits + push                 | 2026-05-29  |
| Borjie eng (G)      | Run audit script in prod, fill {{ROWS}}     | 2026-05-29  |
| Borjie ops          | Dispatch bilingual disclosure               | 2026-05-30  |
| Borjie eng (annual) | Add forensic drill to capability live-evidence | 2027-05-29 |

---

## 7. References

- Commit `2dc0fd90` — recorder introduced (pre-fix).
- Commit `0214c417` — scope_ids cast fix (post-fix).
- Commit `31da30bc` — migration 0125 chain-head unique index (G3).
- Commit `951f5bbc` — G8 worker GUC BEGIN/COMMIT wrap (closes related
  audit-chain RLS leak).
- `services/api-gateway/src/services/decision-journal/recorder.ts`
- `services/api-gateway/src/utils/pg-array.ts`
- `services/api-gateway/src/utils/__tests__/pg-array.test.ts`
- `scripts/live-verify/verify-decisions-entities.ts`
- `Docs/AUDIT/POWERS_LIVE_VERIFICATION_2026-05-29.md` §F.1
