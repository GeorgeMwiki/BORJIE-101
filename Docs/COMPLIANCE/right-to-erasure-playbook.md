# Right-to-Erasure (RTBF) Playbook — Cross-Jurisdictional

_Applies to: GDPR Art. 17, PDPA TZ s. 33, DPA KE s. 26(d), NDPA NG s. 37._

## When this fires

A data subject (tenant, owner, marketplace user) exercises their right to
erasure ("right to be forgotten"). The request can arrive via:

- In-app **Privacy Settings → Delete my account** (canonical path)
- Email to `privacy@<DOMAIN>` (manual triage by DPO)
- Regulator-relayed complaint (PDPC / ODPC / NDPC / EU DPA)

All paths funnel into the same executor:
`packages/ai-copilot/src/gdpr/dsar-rtbf-executor.ts`.

## SLA per jurisdiction

| Jurisdiction | Statute | Window |
|---|---|---|
| TZ | PDPA s. 38 | 30 days (extend +30 once) |
| KE | DPA + Regs r. 12 | 21 days |
| NG | NDPA GAID Pt. III r. 6 | 1 month |
| EU | GDPR Art. 12(3) | 1 month (extend +2 once) |

The executor SLA target is **15 days** to comfortably fit all four windows
with margin for human review.

## Pre-flight checks (legal blockers to erasure)

Erasure is **NOT** unconditional. Block the request and explain to the subject
when any of these apply (GDPR Art. 17(3) analogues):

| Block reason | Statute basis | What to do |
|---|---|---|
| Active lease | All — contract performance | Refuse until lease terminated + statute-of-limitations lapsed |
| Unpaid invoices | All — legitimate interest (recovery) | Refuse until paid OR debt extinguished |
| Pending tax obligation | TZ TRA / KE KRA / NG FIRS / EU member-state | Refuse; tax retention is legal-obligation basis |
| Pending fraud investigation | All — legitimate interest | Refuse until closure |
| Court order to retain | All — legal obligation | Refuse; document court reference |
| Audit trail (s. 27(2) PDPA, Art. 17(3)(e) GDPR) | All | **Pseudonymise** rather than delete |

The executor must surface the block reason to the subject and route an appeal
path through the DPO.

## Table-by-table erasure walk

The executor walks tables in this order (foreign-key safe):

### 1. Application-layer soft delete

```
UPDATE customers SET deleted_at = NOW(), processing_restricted = TRUE
WHERE id = $customer_id;
```

### 2. PII obliteration (per data-classification.ts)

For every column where `level IN ('RESTRICTED', 'CONFIDENTIAL')`:

| Table | Columns | Strategy |
|---|---|---|
| `customers` | email, phone, alternate_phone, first_name, last_name, middle_name, date_of_birth, id_document_number, id_document_front_url, id_document_back_url, kra_pin, tin_number, current_address_line1, current_address_line2, emergency_contact_phone, emergency_contact_email, kyc_notes | Crypto-shred + UPDATE to NULL |
| `customers` | monthly_income, occupation, employer | UPDATE to NULL |
| `users` | email, phone, password_hash, mfa_secret | Crypto-shred + UPDATE to NULL |
| `leases` | tenant_signature_url | Delete S3 object + UPDATE to NULL |
| `payments` | mpesa_phone, mpesa_transaction_id, bank_reference | Crypto-shred. NOTE: bank reference may be retained per tax obligation — check block reasons first |
| `invoices` | customer_notes | UPDATE to NULL |
| `gepg_transactions` | payer_name, payer_phone, payer_email | Crypto-shred + UPDATE to NULL |
| `messages` | body, recipient_phone, recipient_email | Crypto-shred + UPDATE to NULL |
| `voice_turns` | transcript, audio_url | Delete S3 object + UPDATE to NULL |
| `feedback` | body, submitted_by_email | Crypto-shred + UPDATE to NULL |
| `tenant_predictions` | feature_payload | UPDATE to NULL |
| `documents` | storage_url, extracted_text | Delete S3 object + UPDATE to NULL |
| `inspections` | photos (S3 array) | Delete S3 objects + UPDATE to empty array |
| `marketplace_listings` | lister_phone, lister_email | Crypto-shred + UPDATE to NULL |

**Crypto-shred** means: delete the per-tenant DEK (data encryption key) from
the KMS hierarchy in `packages/database/src/security/encryption/`. Ciphertext
remains in DB / S3 but is unrecoverable.

### 3. Audit trail (`audit_events`)

Audit events are **never deleted**. Pseudonymise:

```
UPDATE audit_events SET
  actor_email = 'pseudo:' || sha256(actor_email || $tenant_salt),
  subject_email = 'pseudo:' || sha256(subject_email || $tenant_salt)
WHERE subject_id = $customer_id;
```

The hash preserves equality joins for audit replay while breaking
re-identifiability without the per-tenant salt (rotated quarterly).

### 4. Sovereign Action Ledger (`sovereign_action_ledger`)

Same pseudonymisation as audit_events. The ledger is the legally-required
**immutable record** of regulator-facing actions and MUST survive erasure.

### 5. S3 / object storage

For every column with `maskType IN ('none')` and `RESTRICTED` (id_document
images, voice audio, lease PDFs, inspection photos, doc storage_url):

1. Issue S3 DeleteObject for the underlying key
2. Verify deletion via S3 ListObjects with the key prefix
3. Trigger CloudFront cache invalidation for the public-CDN distribution
4. Log deletion event to sovereign-action-ledger

### 6. Cached / derived data

- **Redis caches**: `FLUSHDB`-equivalent for tenant keyspace
  (`tenant:$tenant_id:customer:$customer_id:*`)
- **Search index** (OpenSearch / Meilisearch): delete documents by customer_id
- **CDN edge cache**: invalidate avatar / document signed URLs
- **AI memory / embeddings store**: delete embeddings for any vector with
  `subject_id = $customer_id`
- **Backups**: backups retain the row but are crypto-shredded indirectly via DEK
  deletion. Document retention timeline for backup expiry (rolling 30-day window).

### 7. Sub-processors (downstream notice)

GDPR Art. 19 / NDPA s. 38(2) — controller must communicate erasure to
recipients of the data. Send erasure notice to:

- WhatsApp Business API (Meta) — opt-out user
- M-Pesa Daraja / OPay / NIBSS — flag as terminated (retain transaction record per CBK / CBN / BoT obligations)
- Marketing email provider — unsubscribe + hash list
- Credit reference bureau (when integrated)

## Confirmation flow

After erasure completes:

1. Email confirmation to subject (use a separate channel — they can't access account)
2. Provide reference ID for any future appeal
3. Log completion to sovereign-action-ledger with hash chain anchor

## Failure handling

If the executor fails partway:

1. Mark request as `IN_PROGRESS_FAILED` in `rtbf_requests` table
2. Page DPO via `<DPO_PAGER>`
3. Quarantine partial state; do not retry blindly — manual review only
4. Document failure in incident log + sovereign ledger

## Verification

Quarterly: run `scripts/rtbf-verification.mjs` — picks a sample of completed
RTBF requests, attempts to look up the subject via every PII column, asserts
no plaintext recovery.

## Statute citations

- GDPR Art. 17(1)(a)–(f) — grounds for erasure
- GDPR Art. 17(3) — exceptions
- PDPA TZ s. 33 — right of erasure
- DPA KE s. 26(d) + s. 40 — erasure right + remedy
- NDPA NG s. 37 — right to erasure
