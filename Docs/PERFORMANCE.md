# Performance Guide

This document collects everything an engineer needs to reason about database
performance on BORJIE: where the indexes live, how to run EXPLAIN against
production, the query budget each endpoint owes its callers, how to detect
N+1 patterns in repositories, and how to size Postgres connection pools.

All performance-relevant indexes are declared in migrations. The most recent
amendment migration is `packages/database/src/migrations/0026_performance_indexes.sql`.
It is additive, idempotent (`CREATE INDEX IF NOT EXISTS` everywhere), and safe
to re-run.

---

## 1. Index Inventory (migration 0026)

Indexes are grouped by the subsystem they support. Every row lists the index,
the table, and the primary query it accelerates.

### Approval policies

| Index | Table | Supports |
|---|---|---|
| `approval_policies_tenant_type_idx` | `approval_policies` | `(tenantId, type)` lookups redundant with PK but cheap to add |
| `approval_policies_policy_json_gin_idx` | `approval_policies` | JSONB `policy_json @> …` filters |

### GePG (control numbers + reconciliation)

| Index | Table | Supports |
|---|---|---|
| `gepg_cn_tenant_status_idx` | `gepg_control_numbers` | dashboard filter by status per tenant |
| `gepg_cn_tenant_expires_idx` (partial) | `gepg_control_numbers` | expiry sweeper job (`status IN ('pending','issued')`) |
| `gepg_cn_tenant_created_brin_idx` | `gepg_control_numbers` | recent-first listing once table grows |
| `gepg_cn_raw_response_gin_idx` | `gepg_control_numbers` | JSONB audit queries on raw provider response |
| `gepg_recon_tenant_occurred_idx` | `gepg_reconciliation_events` | reconciliation timeline per tenant |
| `gepg_recon_cn_idx` / `gepg_recon_payment_idx` | `gepg_reconciliation_events` | lookups by control number / payment |
| `gepg_recon_payload_gin_idx` | `gepg_reconciliation_events` | payload @> audit search |
| `gepg_recon_occurred_brin_idx` | `gepg_reconciliation_events` | range scan on append-only events |

### Arrears ledger

| Index | Table | Supports |
|---|---|---|
| `arrears_prop_tenant_status_idx` | `arrears_line_proposals` | approval queue by status |
| `arrears_prop_tenant_customer_idx` | `arrears_line_proposals` | per-customer arrears feed |
| `arrears_prop_pending_idx` (partial) | `arrears_line_proposals` | pending-approval queue newest first |
| `arrears_prop_evidence_gin_idx` | `arrears_line_proposals` | evidence-document JSONB membership |
| `arrears_prop_proposed_brin_idx` | `arrears_line_proposals` | recent-first timeline |
| `arrears_proj_tenant_case_idx` | `arrears_case_projections` | latest projection per case |
| `arrears_proj_tenant_customer_idx` | `arrears_case_projections` | latest projection per customer |
| `arrears_proj_lines_gin_idx` | `arrears_case_projections` | JSONB line-item queries |
| `arrears_cases_tenant_status_idx` (guarded) | `arrears_cases` | status dashboard |
| `arrears_cases_tenant_customer_idx` (guarded) | `arrears_cases` | per-customer case lookup |

### Negotiation

| Index | Table | Supports |
|---|---|---|
| `negotiation_policies_active_domain_idx` | `negotiation_policies` | active policy lookup per domain |
| `negotiation_policies_concessions_gin_idx` | `negotiation_policies` | JSONB `acceptable_concessions @> …` |
| `negotiations_tenant_status_open_idx` (partial) | `negotiations` | open/counter_sent inbox sorted by last activity |
| `negotiations_listing_idx` (partial) | `negotiations` | find negotiation by listing |
| `negotiations_prospect_idx` (partial) | `negotiations` | customer-facing negotiation history |
| `negotiations_policy_idx` | `negotiations` | join from policy |
| `negotiations_last_activity_brin_idx` | `negotiations` | recent-activity scans |
| `negotiation_turns_tenant_created_brin_idx` | `negotiation_turns` | append-only timeline scans |
| `negotiation_turns_raw_payload_gin_idx` | `negotiation_turns` | raw payload audit search |

### Marketplace

| Index | Table | Supports |
|---|---|---|
| `marketplace_listings_published_idx` (partial) | `marketplace_listings` | public feed, newest first |
| `marketplace_listings_kind_idx` | `marketplace_listings` | filter by kind+status |
| `marketplace_listings_property_idx` (partial) | `marketplace_listings` | per-property rollup |
| `marketplace_listings_attributes_gin_idx` | `marketplace_listings` | attribute search (bedrooms, amenities…) |
| `marketplace_listings_media_gin_idx` | `marketplace_listings` | media metadata queries |
| `tenders_open_closes_idx` (partial) | `tenders` | open-tender closing-soon feed |
| `tenders_invited_vendors_gin_idx` | `tenders` | invite-only vendor check |
| `bids_tender_price_idx` | `bids` | lowest-price bid selection |
| `bids_vendor_tenant_idx` | `bids` | vendor bid history |

### Waitlist

| Index | Table | Supports |
|---|---|---|
| `unit_waitlists_unit_active_idx` (partial) | `unit_waitlists` | active waitlist by priority |
| `unit_waitlists_customer_active_idx` (partial) | `unit_waitlists` | customer dashboard of active entries |
| `unit_waitlists_preferred_channels_gin_idx` | `unit_waitlists` | channel preference filter |
| `waitlist_outreach_events_waitlist_occurred_idx` | `waitlist_outreach_events` | outreach audit per waitlist entry |
| `waitlist_outreach_events_occurred_brin_idx` | `waitlist_outreach_events` | time-range audit |
| `waitlist_outreach_events_payload_gin_idx` | `waitlist_outreach_events` | payload inspection |

### Gamification

| Index | Table | Supports |
|---|---|---|
| `reward_policies_tenant_active_idx` (partial) | `reward_policies` | latest active policy |
| `gm_profile_tenant_customer_idx` | `tenant_gamification_profile` | latest profile per customer |
| `gm_profile_tenant_tier_idx` | `tenant_gamification_profile` | tier distribution queries |
| `reward_event_tenant_customer_occurred_idx` | `reward_events` | per-customer event timeline |
| `reward_event_tenant_dedup_idx` | `reward_events` | idempotency check |
| `reward_event_occurred_brin_idx` | `reward_events` | recent event scans |
| `reward_event_payload_gin_idx` | `reward_events` | JSONB payload audit |

### Conditional surveys

| Index | Table | Supports |
|---|---|---|
| `conditional_surveys_tenant_status_idx` | `conditional_surveys` | status dashboard |
| `conditional_surveys_summary_gin_idx` | `conditional_surveys` | summary attribute search |
| `conditional_survey_findings_survey_severity_idx` | `conditional_survey_findings` | severity breakdown |
| `conditional_survey_findings_metadata_gin_idx` | `conditional_survey_findings` | metadata filters |
| `conditional_survey_action_plans_survey_status_idx` | `conditional_survey_action_plans` | action status per survey |
| `conditional_survey_action_plans_tenant_status_idx` | `conditional_survey_action_plans` | tenant-wide action queue |

### FAR asset components / condition checks

| Index | Table | Supports |
|---|---|---|
| `asset_components_tenant_property_idx` | `asset_components` | per-property inventory by status |
| `asset_components_metadata_gin_idx` | `asset_components` | spec/metadata search |
| `far_assignments_tenant_component_idx` | `far_assignments` | per-component assignments |
| `far_assignments_assigned_to_idx` (partial) | `far_assignments` | user-assigned work queue |
| `condition_check_events_component_performed_idx` | `condition_check_events` | latest check per component |
| `condition_check_events_assignment_performed_idx` | `condition_check_events` | check history per assignment |
| `condition_check_events_due_brin_idx` | `condition_check_events` | due-in-range scans |

### Station master / worker tags

| Index | Table | Supports |
|---|---|---|
| `station_master_coverage_tenant_sm_idx` | `station_master_coverage` | coverage lookup by station master |
| `station_master_coverage_value_gin_idx` | `station_master_coverage` | JSONB coverage value filters |
| `worker_tags_tenant_user_idx` | `worker_tags` | tags per user |
| `worker_tags_tenant_tag_idx` | `worker_tags` | users by tag |
| `worker_tags_metadata_gin_idx` | `worker_tags` | metadata filters |

### Interactive reports

| Index | Table | Supports |
|---|---|---|
| `interactive_report_versions_tenant_instance_idx` | `interactive_report_versions` | latest-version lookup |
| `interactive_report_versions_media_gin_idx` | `interactive_report_versions` | media reference inspection |
| `interactive_report_versions_action_plans_gin_idx` | `interactive_report_versions` | embedded action-plan search |
| `interactive_report_action_acks_version_plan_idx` | `interactive_report_action_acks` | ack lookup by (version, plan) |

### Tenant finance / litigation / risk

| Index | Table | Supports |
|---|---|---|
| `tenant_financial_statements_tenant_status_idx` | `tenant_financial_statements` | verification queue |
| `tenant_financial_statements_tenant_customer_idx` | `tenant_financial_statements` | per-customer latest statement |
| `tenant_financial_statements_sources_gin_idx` | `tenant_financial_statements` | income source audit |
| `tenant_litigation_history_tenant_customer_idx` | `tenant_litigation_history` | per-customer record |
| `tenant_litigation_history_outcome_idx` | `tenant_litigation_history` | outcome rollups |
| `intelligence_history_tenant_customer_date_idx` | `intelligence_history` | time series per customer |
| `intelligence_history_date_brin_idx` | `intelligence_history` | range scans on append-only table |
| `intelligence_history_payment_subs_gin_idx` | `intelligence_history` | sub-score dive |
| `intelligence_history_churn_subs_gin_idx` | `intelligence_history` | sub-score dive |
| `tenant_risk_reports_tenant_customer_idx` | `tenant_risk_reports` | latest report per customer |
| `tenant_risk_reports_tenant_status_idx` | `tenant_risk_reports` | status dashboard |
| `tenant_risk_reports_snapshot_gin_idx` | `tenant_risk_reports` | reproducible snapshot inspection |

### Compliance / migration runs

| Index | Table | Supports |
|---|---|---|
| `compliance_exports_tenant_status_idx` | `compliance_exports` | dashboard of pending/ready |
| `compliance_exports_tenant_type_period_idx` | `compliance_exports` | periodic schedule queries |
| `compliance_exports_regulator_context_gin_idx` | `compliance_exports` | regulator context search |
| `compliance_exports_scheduled_brin_idx` | `compliance_exports` | scheduled-at ranges |
| `migration_runs_tenant_created_idx` | `migration_runs` | recent runs per tenant |
| `migration_runs_{extraction,diff,committed}_summary_gin_idx` | `migration_runs` | summary JSON search |

### Document render / letter / scan / doc-chat

Guarded with `information_schema.tables` checks so the migration stays safe
to run before these drizzle-generated tables materialise.

| Index | Table | Supports |
|---|---|---|
| `document_render_jobs_tenant_status_idx` | `document_render_jobs` | render queue |
| `document_render_jobs_queued_idx` (partial) | `document_render_jobs` | worker `SELECT … WHERE status='queued' FOR UPDATE SKIP LOCKED` |
| `document_render_jobs_input_gin_idx` | `document_render_jobs` | inspect payload |
| `document_render_jobs_requested_brin_idx` | `document_render_jobs` | time range |
| `letter_requests_tenant_status_idx` | `letter_requests` | status queue |
| `letter_requests_tenant_customer_idx` | `letter_requests` | customer history |
| `letter_requests_pending_approval_idx` (partial) | `letter_requests` | approval inbox |
| `letter_requests_payload_gin_idx` | `letter_requests` | payload inspection |
| `scan_bundles_tenant_status_idx` | `scan_bundles` | status queue |
| `scan_bundles_tenant_creator_idx` | `scan_bundles` | creator history |
| `scan_bundles_processing_log_gin_idx` | `scan_bundles` | processing audit |
| `scan_bundle_pages_bundle_page_idx` | `scan_bundle_pages` | ordered page retrieval |
| `document_embeddings_tenant_document_idx` | `document_embeddings` | per-document chunk sweep |
| `document_embeddings_chunk_meta_gin_idx` | `document_embeddings` | chunk metadata filter |
| `doc_chat_sessions_tenant_last_message_idx` | `doc_chat_sessions` | recent sessions |
| `doc_chat_sessions_documents_gin_idx` | `doc_chat_sessions` | session by document id |
| `doc_chat_sessions_participants_gin_idx` | `doc_chat_sessions` | session by participant |
| `doc_chat_messages_session_created_idx` | `doc_chat_messages` | ordered session transcript |
| `doc_chat_messages_tenant_created_brin_idx` | `doc_chat_messages` | range scans |
| `doc_chat_messages_citations_gin_idx` | `doc_chat_messages` | citation audit |

### Damage deduction / sublease / tenant groups / identity

| Index | Table | Supports |
|---|---|---|
| `damage_deduction_cases_tenant_status_idx` | `damage_deduction_cases` | status queue |
| `damage_deduction_cases_ai_turns_gin_idx` | `damage_deduction_cases` | AI mediator audit |
| `sublease_requests_parent_status_idx` | `sublease_requests` | requests under a lease by status |
| `sublease_requests_subtenant_idx` (partial) | `sublease_requests` | subtenant-side view |
| `tenant_groups_members_gin_idx` | `tenant_groups` | member-role membership search |
| `tenant_identities_profile_gin_idx` | `tenant_identities` | profile attribute queries |
| `tenant_identities_merged_into_idx` (partial) | `tenant_identities` | merged-identity resolution |
| `org_memberships_platform_user_idx` | `org_memberships` | user-in-tenant lookup |
| `org_memberships_active_idx` (partial) | `org_memberships` | active membership for login |
| `invite_codes_active_idx` (partial) | `invite_codes` | non-revoked invites per org |
| `invite_codes_attachment_hints_gin_idx` | `invite_codes` | hint-based routing |

### pgvector (document_embeddings.embedding)

Conditional on `CREATE EXTENSION vector`. Migration tries HNSW first
(`m=16, ef_construction=64`); falls back to IVFFlat `lists=100` if HNSW fails.
Enable on managed Postgres with:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then re-run migration 0026 or create manually:

```sql
CREATE INDEX IF NOT EXISTS document_embeddings_vector_hnsw_idx
  ON document_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

## 2. Running EXPLAIN in production

All production access is tenant-scoped via RLS; remember to `SET LOCAL
app.current_tenant_id = '<tenant>'` inside the transaction before running
EXPLAIN, or the query planner will see zero rows.

```sql
BEGIN;
SET LOCAL app.current_tenant_id = 't_demo';
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM invoices WHERE tenant_id = 't_demo' AND status = 'due'
ORDER BY created_at DESC LIMIT 50;
ROLLBACK;
```

Helper: from Node use `explainQuery(db, sql, params)` from
`packages/database/src/query-analyzer.ts` — it wraps EXPLAIN in a read-only
transaction, rolls back, and normalises the plan into a `PlanSummary` with
sequential-scan warnings and timings.

---

## 3. Query budgets (P95 targets per endpoint class)

| Endpoint class | P95 budget | Notes |
|---|---|---|
| Customer-app list view (marketplace, leases, invoices) | 80 ms | Must hit cached index; GIN lookups only on curated filter set. |
| Dashboard summary card | 150 ms | May do up to two round-trips; prefer materialised view or cached aggregate for >3. |
| Writes (single-row INSERT/UPDATE) | 60 ms | No broader-than-tenant scan; audit trigger included. |
| Batch writes (<= 500 rows) | 400 ms | Transactional, idempotent (`ON CONFLICT`). |
| Background workers (render, outreach) | 2 s / job | Worker picks one task at a time via `FOR UPDATE SKIP LOCKED` on partial index. |
| Report generation | 5 s | Async; return job id, poll or subscribe for completion. |

Anything over budget should either acquire an index or degrade to a cached
projection table — add a phase to the next wave rather than hand-tuning.

---

## 4. N+1 detection guide

1. **Log every query.** In dev, wrap the drizzle client with
   `withSlowQueryLogging(db, { logAllQueries: true, onQuery: log })`. Any
   endpoint that emits the same query shape more than N times per request is
   an N+1.
2. **Prefer `IN (…)` batching.** When a repo loads children for a list of
   parents, use a single `WHERE parent_id = ANY(?)` query and group in
   memory rather than one SELECT per parent.
3. **Prefer JSON aggregation** for denormalised reads — e.g. the `payload`
   JSONB column on `cases` caches the aggregate so the read path avoids
   fan-out joins.
4. **Repository rule of thumb:** a repo method should run O(1) queries
   regardless of result-set size. If it loops, it must batch.

---

## 5. Connection pool sizing

Postgres connections are expensive. Use this formula per process:

```
pool_size = max(
  concurrent_requests_per_process * avg_queries_per_request,
  4          # floor so background workers have headroom
)
```

Typical starting values:

| Tier | `pool_size` per process | Notes |
|---|---|---|
| API server | 10 | Tune up only if `wait_events = ClientRead` climbs. |
| Worker pool | 4 | One connection per concurrent job. |
| CLI / migration | 2 | Short-lived. |

**Total connections across all processes must stay below
`max_connections - superuser_reserved_connections`** on the primary. Above
~100 concurrent connections, prefer PgBouncer in transaction-pooling mode and
cap per-client pool sizes to 5.

SLOW_QUERY_THRESHOLD_MS (default 500) should be set in env for each service
and fed into `withSlowQueryLogging` — any value exceeding the endpoint
budgets above is already a regression.

---

## 6. When to add a new index

1. Do you have the query? Capture the actual SQL (or Drizzle call) first.
2. Run `explainQuery` — is there a Seq Scan on a large table?
3. Would a partial index (`WHERE status = 'active'`) be tighter?
4. Is the column a JSONB accessor? Use GIN with `jsonb_path_ops` when you
   only need `@>` queries — it's smaller.
5. Is the table append-only with >1M rows projected? Add a BRIN on the
   monotonic timestamp column — BRIN indexes are orders of magnitude smaller
   than B-tree.
6. Always `CREATE INDEX IF NOT EXISTS` in a new migration file. Never edit
   historic migration files after they've been applied upstream.

---

## 7. Further reading

- `packages/database/src/query-analyzer.ts` — EXPLAIN helper with plan
  summarisation and warnings.
- `packages/database/src/slow-query-logger.ts` — drop-in wrapper around the
  drizzle client.
- `packages/database/src/migrations/0026_performance_indexes.sql` — source of
  truth for the indexes documented above.
