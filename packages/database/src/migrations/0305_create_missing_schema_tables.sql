-- =============================================================================
-- Migration 0305 — schema-ahead-of-migrations remediation: CREATE the 138
-- tables that existed in the Drizzle schema (packages/database/src/schemas/*)
-- but had NO CREATE migration, so the live DB drifted behind the schema the
-- app compiles against. Brings the DB into sync with the schema.
--
-- PROVENANCE: table set = (all Drizzle pgTable defs) MINUS (live information_
-- schema tables), audited 2026-06-08. DDL extracted from `drizzle-kit generate`
-- (authoritative types/indexes/FKs). A 74-agent classification labelled ~71
-- genuine / ~41 dead / 26 unclassified; rather than risk missing a mislabelled
-- table, ALL 138 are created (dead ones are harmless empties to drop in a later
-- schema-cleanup pass). Validated by applying the whole migration inside a txn
-- against the live schema and ROLLING BACK (apply-then-rollback dry-run) — it
-- applied cleanly (0 errors) before this real apply.
--
-- RLS (CLAUDE.md hard rule — FORCE on every tenant-scoped table): per-scope
-- policy on the canonical `app.current_tenant_id` GUC —
--   * `tenant_id`         (115 tables) → tenant_id = guc  (uuid cols cast ::text)
--   * `scope_tenant_id`   (3)          → scope_tenant_id IS NULL OR = guc (global rows visible)
--   * `scope_kind/scope_id` (1)        → scope_kind <> 'tenant' OR scope_id = guc
--   * no scope column     (19 global/HQ) → no RLS (e.g. currency_rates, feature_flags, platform_*)
--
-- IDEMPOTENT: every statement is CREATE ... IF NOT EXISTS or a guarded DO-block
-- (pg_type / pg_constraint / pg_policies / pg_roles), so a re-run is a no-op.
--
-- FOLLOW-UPS (see memory borjie-live-db-migration-state / task_0f0cccf4):
--   * schema cleanup — delete the ~41 confirmed-dead schema defs (+ barrel lines);
--   * stale property-domain enum values (e.g. audit_category PROPERTY/LEASE) → mining;
--   * 2 user_id-only + a few non-tenant_id tables may need a bespoke RLS decision.
-- =============================================================================
BEGIN;

-- Enums (guarded).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_actor_type') THEN
    CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'service', 'system');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_category') THEN
    CREATE TYPE "public"."audit_category" AS ENUM('AUTH', 'AUTHZ', 'TENANT', 'USER', 'PROPERTY', 'LEASE', 'PAYMENT', 'MAINTENANCE', 'DOCUMENT', 'COMMUNICATION', 'SYSTEM', 'DATA_ACCESS');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_outcome') THEN
    CREATE TYPE "public"."audit_outcome" AS ENUM('SUCCESS', 'FAILURE', 'DENIED', 'ERROR');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_severity') THEN
    CREATE TYPE "public"."audit_severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_event_type') THEN
    CREATE TYPE "public"."audit_event_type" AS ENUM('user.created', 'user.updated', 'user.deleted', 'user.login', 'user.logout', 'user.password_changed', 'tenant.created', 'tenant.updated', 'tenant.suspended', 'role.assigned', 'role.revoked', 'permission.granted', 'permission.revoked', 'data.accessed', 'data.modified', 'data.exported');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'borjie_plan') THEN
    CREATE TYPE "public"."borjie_plan" AS ENUM('mwanzo', 'mkulima', 'mfanyabiashara', 'kampuni', 'group');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'borjie_user_role') THEN
    CREATE TYPE "public"."borjie_user_role" AS ENUM('owner', 'admin', 'site_manager', 'supervisor', 'driver', 'geologist', 'stores', 'qc_officer', 'buyer', 'borjie_team');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE "public"."session_status" AS ENUM('active', 'expired', 'revoked');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_tier') THEN
    CREATE TYPE "public"."subscription_tier" AS ENUM('starter', 'professional', 'enterprise', 'custom');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_status') THEN
    CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'pending', 'trial', 'cancelled');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
    CREATE TYPE "public"."user_status" AS ENUM('pending_activation', 'active', 'suspended', 'deactivated');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_membership_status') THEN
    CREATE TYPE "public"."org_membership_status" AS ENUM('ACTIVE', 'LEFT', 'BLOCKED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_identity_status') THEN
    CREATE TYPE "public"."tenant_identity_status" AS ENUM('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marketplace_bid_payment_terms') THEN
    CREATE TYPE "public"."marketplace_bid_payment_terms" AS ENUM('instant', 'net_30', 'net_60');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'marketplace_bid_status') THEN
    CREATE TYPE "public"."marketplace_bid_status" AS ENUM('pending', 'accepted', 'rejected', 'countered', 'withdrawn');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'badge_type') THEN
    CREATE TYPE "public"."badge_type" AS ENUM('identity_verified', 'address_verified', 'income_verified', 'employer_verified', 'references_verified', 'kyc_complete', 'premium_tenant');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_source') THEN
    CREATE TYPE "public"."document_source" AS ENUM('whatsapp', 'app_upload', 'email', 'scan', 'api', 'manual');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
    CREATE TYPE "public"."document_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ocr_complete', 'validated', 'rejected', 'expired', 'archived');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type') THEN
    CREATE TYPE "public"."document_type" AS ENUM('national_id', 'passport', 'driving_license', 'work_permit', 'residence_permit', 'utility_bill', 'bank_statement', 'employment_letter', 'lease_agreement', 'move_in_report', 'move_out_report', 'maintenance_photo', 'receipt', 'notice', 'mining_licence', 'royalty_return', 'accountant_export', 'other');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fraud_risk_level') THEN
    CREATE TYPE "public"."fraud_risk_level" AS ENUM('low', 'medium', 'high', 'critical');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
    CREATE TYPE "public"."verification_status" AS ENUM('pending', 'in_review', 'verified', 'partially_verified', 'rejected', 'expired', 'manual_override');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
    CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed', 'bounced', 'blocked', 'expired', 'unknown');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_channel') THEN
    CREATE TYPE "public"."message_channel" AS ENUM('whatsapp', 'sms', 'email', 'app_push', 'voice_call', 'in_app');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
    CREATE TYPE "public"."message_status" AS ENUM('queued', 'pending', 'sent', 'delivered', 'read', 'failed', 'bounced', 'blocked', 'expired');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_category') THEN
    CREATE TYPE "public"."template_category" AS ENUM('payment_reminder', 'payment_confirmation', 'maintenance_update', 'lease_notification', 'onboarding', 'renewal', 'legal_notice', 'emergency', 'announcement', 'marketing', 'feedback_request', 'check_in', 'welcome', 'other');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_status') THEN
    CREATE TYPE "public"."template_status" AS ENUM('draft', 'pending_approval', 'approved', 'active', 'deprecated', 'archived');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_priority') THEN
    CREATE TYPE "public"."event_priority" AS ENUM('low', 'normal', 'high', 'critical');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status') THEN
    CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'processing', 'published', 'failed', 'dead_letter');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thread_event_kind') THEN
    CREATE TYPE "public"."thread_event_kind" AS ENUM('user_message', 'persona_message', 'tool_call', 'tool_result', 'handoff_out', 'handoff_in', 'review_requested', 'review_decision', 'system_note');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thread_status') THEN
    CREATE TYPE "public"."thread_status" AS ENUM('open', 'resolved', 'archived');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'visibility_scope') THEN
    CREATE TYPE "public"."visibility_scope" AS ENUM('private', 'team', 'management', 'public');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'render_job_status') THEN
    CREATE TYPE "public"."render_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'renderer_kind') THEN
    CREATE TYPE "public"."renderer_kind" AS ENUM('text', 'docxtemplater', 'react-pdf', 'typst');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scan_bundle_status') THEN
    CREATE TYPE "public"."scan_bundle_status" AS ENUM('draft', 'processing', 'ready', 'submitted', 'failed');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'doc_chat_scope') THEN
    CREATE TYPE "public"."doc_chat_scope" AS ENUM('single_document', 'multi_document', 'group_chat');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'doc_chat_role') THEN
    CREATE TYPE "public"."doc_chat_role" AS ENUM('user', 'assistant', 'system');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migration_run_status') THEN
    CREATE TYPE "public"."migration_run_status" AS ENUM('uploaded', 'extracted', 'diffed', 'approved', 'committing', 'committed', 'failed');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kernel_scope_kind') THEN
    CREATE TYPE "public"."kernel_scope_kind" AS ENUM('tenant', 'platform');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kernel_stakes') THEN
    CREATE TYPE "public"."kernel_stakes" AS ENUM('low', 'medium', 'high', 'critical');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kernel_tier') THEN
    CREATE TYPE "public"."kernel_tier" AS ENUM('tenant', 'offtake', 'pit', 'zone', 'site', 'portfolio', 'org', 'industry');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'persona_drift_severity') THEN
    CREATE TYPE "public"."persona_drift_severity" AS ENUM('low', 'medium', 'high');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'persona_drift_violation') THEN
    CREATE TYPE "public"."persona_drift_violation" AS ENUM('taboo', 'first-person-loss', 'tone', 'fabrication');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kernel_memory_episodic_kind') THEN
    CREATE TYPE "public"."kernel_memory_episodic_kind" AS ENUM('user-message', 'agent-action', 'tool-result');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kernel_memory_semantic_source') THEN
    CREATE TYPE "public"."kernel_memory_semantic_source" AS ENUM('extracted', 'declared', 'consolidated');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kernel_memory_reflective_period') THEN
    CREATE TYPE "public"."kernel_memory_reflective_period" AS ENUM('daily', 'weekly', 'monthly');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sovereign_approval_stakes') THEN
    CREATE TYPE "public"."sovereign_approval_stakes" AS ENUM('medium', 'high', 'critical');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sovereign_approval_status') THEN
    CREATE TYPE "public"."sovereign_approval_status" AS ENUM('pending', 'one-eye', 'approved', 'rejected', 'expired');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'interactive_report_render_kind') THEN
    CREATE TYPE "public"."interactive_report_render_kind" AS ENUM('html_bundle', 'html_with_video', 'html_with_charts', 'print_pdf_fallback');
  END IF;
END $$;

-- Tables (idempotent).
CREATE TABLE IF NOT EXISTS "a2a_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"status" text NOT NULL,
	"message" jsonb NOT NULL,
	"artifacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at_iso" text NOT NULL,
	"updated_at_iso" text NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_a2a_tasks_tenant_session" ON "a2a_tasks" USING btree ("tenant_id","session_id");
CREATE INDEX IF NOT EXISTS "idx_a2a_tasks_status" ON "a2a_tasks" USING btree ("status");
CREATE TABLE IF NOT EXISTS "action_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"module_id" text,
	"intent" text NOT NULL,
	"plan_jsonb" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"audit_chain_link" text,
	"budget_micros" integer NOT NULL,
	"budget_used_micros" integer DEFAULT 0 NOT NULL,
	"source_capture_id" text,
	"source_brief_id" text,
	"source_document_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT NOW() + INTERVAL '72 hours' NOT NULL,
	CONSTRAINT "action_plans_status_chk" CHECK ("action_plans"."status" IN ('DRAFT','ROUTED_FOR_APPROVAL','APPROVED','EXECUTING','PARTIAL','COMPLETED','FAILED','COMPENSATED','COMPENSATION_FAILED','EXPIRED','CANCELLED')),
	CONSTRAINT "action_plans_budget_chk" CHECK ("action_plans"."budget_micros" >= 0 AND "action_plans"."budget_used_micros" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_action_plans_tenant_status" ON "action_plans" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_action_plans_persona" ON "action_plans" USING btree ("tenant_id","persona_id");
CREATE INDEX IF NOT EXISTS "idx_action_plans_intent" ON "action_plans" USING btree ("tenant_id","intent");
CREATE INDEX IF NOT EXISTS "idx_action_plans_expires" ON "action_plans" USING btree ("expires_at");
CREATE TABLE IF NOT EXISTS "action_quotas" (
	"tenant_id" text NOT NULL,
	"persona_id" text,
	"period_date" date NOT NULL,
	"plans_created" integer DEFAULT 0 NOT NULL,
	"plans_approved" integer DEFAULT 0 NOT NULL,
	"plans_executed" integer DEFAULT 0 NOT NULL,
	"money_micros" integer DEFAULT 0 NOT NULL,
	"budget_micros_used" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "action_quotas_tenant_id_persona_id_period_date_pk" PRIMARY KEY("tenant_id","persona_id","period_date"),
	CONSTRAINT "action_quotas_plans_created_chk" CHECK ("action_quotas"."plans_created" >= 0),
	CONSTRAINT "action_quotas_money_chk" CHECK ("action_quotas"."money_micros" >= 0 AND "action_quotas"."budget_micros_used" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_action_quotas_period" ON "action_quotas" USING btree ("period_date");
CREATE INDEX IF NOT EXISTS "idx_action_quotas_persona" ON "action_quotas" USING btree ("tenant_id","persona_id","period_date");
CREATE TABLE IF NOT EXISTS "action_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"step_index" smallint NOT NULL,
	"kind" text NOT NULL,
	"payload_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_call_ref" text,
	"otel_span_id" text,
	"audit_chain_id" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	"compensation_step_index" smallint,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_steps_kind_chk" CHECK ("action_steps"."kind" IN ('DRAFT_LETTER','ROUTE_APPROVAL','POST_LEDGER','FILE_GEPG','SEND_WHATSAPP','SEND_SMS','SEND_EMAIL','SCHEDULE_FIELD_VISIT','MUTATE_ENTITY','CALL_EXTERNAL_API','EMIT_WEBHOOK','NOTIFY','VERIFY','COMPENSATE')),
	CONSTRAINT "action_steps_status_chk" CHECK ("action_steps"."status" IN ('PENDING','RUNNING','SUCCEEDED','FAILED','COMPENSATING','COMPENSATED','SKIPPED')),
	CONSTRAINT "action_steps_step_index_chk" CHECK ("action_steps"."step_index" >= 0),
	CONSTRAINT "action_steps_attempts_chk" CHECK ("action_steps"."attempts" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "action_steps_plan_step_idx" ON "action_steps" USING btree ("plan_id","step_index");
CREATE INDEX IF NOT EXISTS "idx_action_steps_plan" ON "action_steps" USING btree ("plan_id","step_index");
CREATE INDEX IF NOT EXISTS "idx_action_steps_tenant_status" ON "action_steps" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_action_steps_tool_call_ref" ON "action_steps" USING btree ("tenant_id","tool_call_ref");
CREATE INDEX IF NOT EXISTS "idx_action_steps_kind" ON "action_steps" USING btree ("tenant_id","kind");
CREATE TABLE IF NOT EXISTS "agency_run_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"step_index" integer NOT NULL,
	"step_name" text NOT NULL,
	"state" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"input_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_payload" jsonb,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "uq_agency_run_checkpoints_run_step" UNIQUE("run_id","step_index")
);
CREATE INDEX IF NOT EXISTS "idx_agency_checkpoints_state" ON "agency_run_checkpoints" USING btree ("state","started_at");
CREATE INDEX IF NOT EXISTS "idx_agency_checkpoints_tenant_run" ON "agency_run_checkpoints" USING btree ("tenant_id","run_id","step_index");
CREATE TABLE IF NOT EXISTS "ai_cost_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd_micro" bigint DEFAULT 0 NOT NULL,
	"operation" text,
	"correlation_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_ai_cost_tenant_time" ON "ai_cost_entries" USING btree ("tenant_id","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_ai_cost_tenant_model" ON "ai_cost_entries" USING btree ("tenant_id","model");
CREATE TABLE IF NOT EXISTS "ai_decision_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"proposed_verb" text NOT NULL,
	"proposed_object" text NOT NULL,
	"risk_level" text NOT NULL,
	"operator_verdict" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_ai_feedback_tenant" ON "ai_decision_feedback" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_ai_feedback_persona" ON "ai_decision_feedback" USING btree ("tenant_id","persona_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_ai_feedback_turn" ON "ai_decision_feedback" USING btree ("tenant_id","turn_id");
CREATE TABLE IF NOT EXISTS "ai_proactive_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"priority" integer DEFAULT 3 NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_points" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requires_operator_action" boolean DEFAULT false NOT NULL,
	"ack_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_proactive_alerts_tenant" ON "ai_proactive_alerts" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_proactive_alerts_scope" ON "ai_proactive_alerts" USING btree ("tenant_id","scope_kind","scope_id");
CREATE TABLE IF NOT EXISTS "ai_semantic_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"persona_id" text,
	"memory_type" text DEFAULT 'interaction' NOT NULL,
	"content" text NOT NULL,
	"embedding" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0.8 NOT NULL,
	"decay_score" double precision DEFAULT 1 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"session_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_ai_memory_tenant_persona" ON "ai_semantic_memories" USING btree ("tenant_id","persona_id");
CREATE INDEX IF NOT EXISTS "idx_ai_memory_tenant_decay" ON "ai_semantic_memories" USING btree ("tenant_id","decay_score");
CREATE INDEX IF NOT EXISTS "idx_ai_memory_last_access" ON "ai_semantic_memories" USING btree ("last_accessed_at");
CREATE TABLE IF NOT EXISTS "anchor_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"session_id" text NOT NULL,
	"start_turn_idx" integer NOT NULL,
	"end_turn_idx" integer NOT NULL,
	"summary" text NOT NULL,
	"original_tokens" integer DEFAULT 0 NOT NULL,
	"summary_tokens" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_anchor_summaries_tenant_session_range" ON "anchor_summaries" USING btree ("tenant_id","session_id","start_turn_idx","end_turn_idx");
CREATE INDEX IF NOT EXISTS "idx_anchor_summaries_tenant_session_created" ON "anchor_summaries" USING btree ("tenant_id","session_id","created_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "aop_active_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_tenant_id" text,
	"version" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_aop_active_versions_scope_id" ON "aop_active_versions" USING btree ("scope_tenant_id","id");
CREATE TABLE IF NOT EXISTS "aop_regression_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_tenant_id" text,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_aop_regression_sets_scope" ON "aop_regression_sets" USING btree ("scope_tenant_id");
CREATE TABLE IF NOT EXISTS "aop_specs" (
	"id" text NOT NULL,
	"version" text NOT NULL,
	"scope_tenant_id" text,
	"spec" jsonb NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aop_specs_id_version_pk" PRIMARY KEY("id","version")
);
CREATE INDEX IF NOT EXISTS "idx_aop_specs_inserted_at" ON "aop_specs" USING btree ("inserted_at");
CREATE INDEX IF NOT EXISTS "idx_aop_specs_scope" ON "aop_specs" USING btree ("scope_tenant_id");
CREATE TABLE IF NOT EXISTS "approval_matrix_dsl_compiled" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"rule_slug" text NOT NULL,
	"predicate_jsonb" jsonb NOT NULL,
	"required_role_group" text NOT NULL,
	"quorum" smallint DEFAULT 1 NOT NULL,
	"notify_role_group" text,
	"priority" smallint DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_matrix_quorum_chk" CHECK ("approval_matrix_dsl_compiled"."quorum" >= 1 AND "approval_matrix_dsl_compiled"."quorum" <= 10)
);
CREATE INDEX IF NOT EXISTS "idx_approval_matrix_priority" ON "approval_matrix_dsl_compiled" USING btree ("tenant_id","priority");
CREATE INDEX IF NOT EXISTS "idx_approval_matrix_active" ON "approval_matrix_dsl_compiled" USING btree ("active");
CREATE TABLE IF NOT EXISTS "approval_policies" (
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"policy_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "approval_policies_tenant_id_type_pk" PRIMARY KEY("tenant_id","type")
);
CREATE INDEX IF NOT EXISTS "approval_policies_tenant_idx" ON "approval_policies" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "approval_policy_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"action_type" text NOT NULL,
	"min_total_approvers" integer NOT NULL,
	"role_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_stale_minutes" integer DEFAULT 1440 NOT NULL,
	"recall_window_minutes" integer DEFAULT 0 NOT NULL,
	"re_auth_required" boolean DEFAULT false NOT NULL,
	"re_auth_max_age_seconds" integer DEFAULT 300 NOT NULL,
	"allow_proposer_signature" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "approval_policy_actions_min_total_chk" CHECK ("approval_policy_actions"."min_total_approvers" >= 1 AND "approval_policy_actions"."min_total_approvers" <= 5),
	CONSTRAINT "approval_policy_actions_max_stale_chk" CHECK ("approval_policy_actions"."max_stale_minutes" > 0),
	CONSTRAINT "approval_policy_actions_recall_chk" CHECK ("approval_policy_actions"."recall_window_minutes" >= 0),
	CONSTRAINT "approval_policy_actions_re_auth_age_chk" CHECK ("approval_policy_actions"."re_auth_max_age_seconds" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_approval_policy_actions_tenant_action" ON "approval_policy_actions" USING btree ("tenant_id","action_type");
CREATE INDEX IF NOT EXISTS "idx_approval_policy_actions_action" ON "approval_policy_actions" USING btree ("action_type");
CREATE INDEX IF NOT EXISTS "idx_approval_policy_actions_tenant" ON "approval_policy_actions" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"event_type" "audit_event_type" NOT NULL,
	"action" text NOT NULL,
	"description" text,
	"actor_id" text,
	"actor_email" text,
	"actor_name" text,
	"actor_type" text DEFAULT 'user' NOT NULL,
	"target_type" text,
	"target_id" text,
	"ip_address" text,
	"user_agent" text,
	"session_id" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "audit_events_event_type_idx" ON "audit_events" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id");
CREATE INDEX IF NOT EXISTS "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");
CREATE INDEX IF NOT EXISTS "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at");
CREATE TABLE IF NOT EXISTS "autonomous_action_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_persona" text NOT NULL,
	"action" text NOT NULL,
	"domain" text NOT NULL,
	"target_entity_kind" text,
	"target_entity_id" text,
	"reasoning" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"policy_rule_matched" text,
	"chain_id" text,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_auton_audit_tenant_created" ON "autonomous_action_audit" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_auton_audit_domain" ON "autonomous_action_audit" USING btree ("tenant_id","domain","created_at");
CREATE INDEX IF NOT EXISTS "idx_auton_audit_chain" ON "autonomous_action_audit" USING btree ("chain_id");
CREATE TABLE IF NOT EXISTS "autonomy_policies" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"autonomous_mode_enabled" boolean DEFAULT false NOT NULL,
	"policy_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"escalation_primary_user_id" text,
	"escalation_secondary_user_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
CREATE INDEX IF NOT EXISTS "idx_autonomy_policies_enabled" ON "autonomy_policies" USING btree ("tenant_id","autonomous_mode_enabled");
CREATE TABLE IF NOT EXISTS "bottlenecks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"process_kind" text NOT NULL,
	"stage" text NOT NULL,
	"bottleneck_kind" text NOT NULL,
	"severity" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggested_remediation" text,
	"status" text DEFAULT 'open' NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"cooldown_until" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_bottlenecks_tenant_open" ON "bottlenecks" USING btree ("tenant_id","status","severity");
CREATE INDEX IF NOT EXISTS "idx_bottlenecks_kind" ON "bottlenecks" USING btree ("tenant_id","process_kind","stage","status");
CREATE TABLE IF NOT EXISTS "carbon_market_book_entries" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"counterparty" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" numeric(20, 6) NOT NULL,
	"price_per_unit_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"tenor" text,
	"trade_date" timestamp with time zone DEFAULT now() NOT NULL,
	"settlement_date" timestamp with time zone,
	"status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "carbon_market_book_entries_tenant_status_idx" ON "carbon_market_book_entries" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "carbon_market_book_entries_tenant_symbol_idx" ON "carbon_market_book_entries" USING btree ("tenant_id","symbol","trade_date");
CREATE TABLE IF NOT EXISTS "communication_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"category" "template_category" NOT NULL,
	"is_consented" boolean NOT NULL,
	"consent_source" text NOT NULL,
	"consent_method" text,
	"consented_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"evidence_url" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "communication_consents_tenant_idx" ON "communication_consents" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "communication_consents_customer_idx" ON "communication_consents" USING btree ("customer_id");
CREATE INDEX IF NOT EXISTS "communication_consents_channel_idx" ON "communication_consents" USING btree ("channel");
CREATE INDEX IF NOT EXISTS "communication_consents_category_idx" ON "communication_consents" USING btree ("category");
CREATE UNIQUE INDEX IF NOT EXISTS "communication_consents_customer_channel_category_idx" ON "communication_consents" USING btree ("customer_id","channel","category");
CREATE TABLE IF NOT EXISTS "consolidation_emissions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"emission_date" date NOT NULL,
	"tick_id" text NOT NULL,
	"facts_distilled" integer DEFAULT 0 NOT NULL,
	"facts_promoted" integer DEFAULT 0 NOT NULL,
	"reflexion_lessons_written" integer DEFAULT 0 NOT NULL,
	"entities_consolidated" integer DEFAULT 0 NOT NULL,
	"communities_detected" integer DEFAULT 0 NOT NULL,
	"rows_re_embedded" integer DEFAULT 0 NOT NULL,
	"digest_markdown" text,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consolidation_emissions_tenant_date_unique" UNIQUE("tenant_id","emission_date")
);
CREATE INDEX IF NOT EXISTS "idx_consolidation_emissions_tenant_date" ON "consolidation_emissions" USING btree ("tenant_id","emission_date");
CREATE INDEX IF NOT EXISTS "idx_consolidation_emissions_emitted_at" ON "consolidation_emissions" USING btree ("emitted_at");
CREATE TABLE IF NOT EXISTS "conversation_capture" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text,
	"message_id" text,
	"persona_id" text NOT NULL,
	"user_id" text,
	"user_text" text NOT NULL,
	"assistant_text" text NOT NULL,
	"decision_kind" text NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"intent" text NOT NULL,
	"intent_confidence" double precision DEFAULT 0 NOT NULL,
	"capture_confidence" double precision DEFAULT 0 NOT NULL,
	"persona_trust" double precision DEFAULT 0.7 NOT NULL,
	"tenant_trust" double precision DEFAULT 0.8 NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"exchange_hash" text NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "conversation_capture_tenant_created_idx" ON "conversation_capture" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "conversation_capture_tenant_intent_idx" ON "conversation_capture" USING btree ("tenant_id","intent");
CREATE INDEX IF NOT EXISTS "conversation_capture_thread_idx" ON "conversation_capture" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "conversation_capture_message_idx" ON "conversation_capture" USING btree ("message_id");
CREATE INDEX IF NOT EXISTS "conversation_capture_hash_idx" ON "conversation_capture" USING btree ("tenant_id","exchange_hash");
CREATE TABLE IF NOT EXISTS "core_memory_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text,
	"persona_id" text NOT NULL,
	"block_kind" text NOT NULL,
	"block_text" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_core_memory_blocks_tenant_user_persona" ON "core_memory_blocks" USING btree ("tenant_id","user_id","persona_id","updated_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_core_memory_blocks_persona_kind" ON "core_memory_blocks" USING btree ("persona_id","block_kind","updated_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "cross_tenant_denials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caller_tenant_id" text NOT NULL,
	"foreign_tenant_id" text,
	"actor_id" text,
	"persona_id" text,
	"session_id" text,
	"violation_path" text NOT NULL,
	"violation_type" text NOT NULL,
	"severity" text NOT NULL,
	"detail" text NOT NULL,
	"verdict" text NOT NULL,
	"surface" text,
	"trace_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_cross_tenant_denials_caller" ON "cross_tenant_denials" USING btree ("caller_tenant_id","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_cross_tenant_denials_severity" ON "cross_tenant_denials" USING btree ("severity","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_cross_tenant_denials_verdict" ON "cross_tenant_denials" USING btree ("verdict","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_cross_tenant_denials_trace" ON "cross_tenant_denials" USING btree ("trace_id");
CREATE TABLE IF NOT EXISTS "currency_preferences" (
	"scope_kind" text NOT NULL,
	"scope_id" text NOT NULL,
	"currency" text NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currency_preferences_scope_kind_scope_id_pk" PRIMARY KEY("scope_kind","scope_id")
);
CREATE INDEX IF NOT EXISTS "idx_currency_preferences_kind" ON "currency_preferences" USING btree ("scope_kind");
CREATE TABLE IF NOT EXISTS "currency_rates" (
	"code" text PRIMARY KEY NOT NULL,
	"rate_to_usd" double precision NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text
);
CREATE INDEX IF NOT EXISTS "idx_currency_rates_as_of" ON "currency_rates" USING btree ("as_of");
CREATE TABLE IF NOT EXISTS "decision_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finalised_at" timestamp with time zone NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"branches" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"chosen_branch_id" text,
	"chosen_rationale" text,
	"outcome" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"user_id" text,
	"request_id" text,
	"parent_trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "decision_traces_tenant_started_idx" ON "decision_traces" USING btree ("tenant_id","started_at");
CREATE INDEX IF NOT EXISTS "decision_traces_tenant_outcome_idx" ON "decision_traces" USING btree ("tenant_id","outcome");
CREATE INDEX IF NOT EXISTS "decision_traces_name_started_idx" ON "decision_traces" USING btree ("name","started_at");
CREATE TABLE IF NOT EXISTS "delivery_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"message_instance_id" text NOT NULL,
	"status" "delivery_status" NOT NULL,
	"previous_status" "delivery_status",
	"provider" text,
	"provider_receipt_id" text,
	"provider_response" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"error_code" text,
	"error_message" text,
	"device_info" jsonb DEFAULT '{}'::jsonb,
	"read_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "delivery_receipts_tenant_idx" ON "delivery_receipts" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "delivery_receipts_message_instance_idx" ON "delivery_receipts" USING btree ("message_instance_id");
CREATE INDEX IF NOT EXISTS "delivery_receipts_status_idx" ON "delivery_receipts" USING btree ("status");
CREATE INDEX IF NOT EXISTS "delivery_receipts_occurred_at_idx" ON "delivery_receipts" USING btree ("occurred_at");
CREATE INDEX IF NOT EXISTS "delivery_receipts_provider_receipt_idx" ON "delivery_receipts" USING btree ("provider","provider_receipt_id");
CREATE TABLE IF NOT EXISTS "doc_chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"role" "doc_chat_role" NOT NULL,
	"author_user_id" text,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retrieved_chunk_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"tokens_used" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "doc_chat_messages_tenant_idx" ON "doc_chat_messages" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "doc_chat_messages_session_idx" ON "doc_chat_messages" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "doc_chat_messages_role_idx" ON "doc_chat_messages" USING btree ("role");
CREATE TABLE IF NOT EXISTS "doc_chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"scope" "doc_chat_scope" DEFAULT 'single_document' NOT NULL,
	"title" text,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "doc_chat_sessions_tenant_idx" ON "doc_chat_sessions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "doc_chat_sessions_created_by_idx" ON "doc_chat_sessions" USING btree ("created_by");
CREATE TABLE IF NOT EXISTS "document_access_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_upload_id" text NOT NULL,
	"accessed_by" text NOT NULL,
	"accessed_by_type" text NOT NULL,
	"action" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"purpose" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "document_access_logs_tenant_idx" ON "document_access_logs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "document_access_logs_document_upload_idx" ON "document_access_logs" USING btree ("document_upload_id");
CREATE INDEX IF NOT EXISTS "document_access_logs_accessed_by_idx" ON "document_access_logs" USING btree ("accessed_by");
CREATE INDEX IF NOT EXISTS "document_access_logs_accessed_at_idx" ON "document_access_logs" USING btree ("accessed_at");
CREATE TABLE IF NOT EXISTS "document_corpus_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"chunk_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "dcl_document_chunk_uniq" ON "document_corpus_links" USING btree ("document_id","chunk_id");
CREATE INDEX IF NOT EXISTS "idx_dcl_tenant_document" ON "document_corpus_links" USING btree ("tenant_id","document_id","chunk_index");
CREATE INDEX IF NOT EXISTS "idx_dcl_tenant_chunk" ON "document_corpus_links" USING btree ("tenant_id","chunk_id");
CREATE TABLE IF NOT EXISTS "document_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"chunk_meta" jsonb DEFAULT '{}'::jsonb,
	"embedding" vector(1536) NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "document_embeddings_tenant_idx" ON "document_embeddings" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "document_embeddings_document_idx" ON "document_embeddings" USING btree ("document_id");
CREATE TABLE IF NOT EXISTS "document_intelligence_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"initial_prompt" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_dis_tenant_user_created" ON "document_intelligence_sessions" USING btree ("tenant_id","user_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_dis_tenant_last_message" ON "document_intelligence_sessions" USING btree ("tenant_id","last_message_at");
CREATE TABLE IF NOT EXISTS "document_render_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" text NOT NULL,
	"renderer_kind" "renderer_kind" NOT NULL,
	"status" "render_job_status" DEFAULT 'queued' NOT NULL,
	"input_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_document_id" text,
	"output_mime_type" text,
	"output_size_bytes" integer,
	"page_count" integer,
	"error_code" text,
	"error_message" text,
	"related_entity_type" text,
	"related_entity_id" text,
	"requested_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "document_render_jobs_tenant_idx" ON "document_render_jobs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "document_render_jobs_status_idx" ON "document_render_jobs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "document_render_jobs_template_idx" ON "document_render_jobs" USING btree ("template_id");
CREATE INDEX IF NOT EXISTS "document_render_jobs_related_idx" ON "document_render_jobs" USING btree ("related_entity_type","related_entity_id");
CREATE TABLE IF NOT EXISTS "episodic_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"session_id" text NOT NULL,
	"turn_idx" integer NOT NULL,
	"event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" text,
	"importance_score" double precision DEFAULT 0.4 NOT NULL,
	"parents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"soft_deleted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_episodic_notes_tenant_session_turn" ON "episodic_notes" USING btree ("tenant_id","session_id","turn_idx");
CREATE INDEX IF NOT EXISTS "idx_episodic_notes_tenant_created" ON "episodic_notes" USING btree ("tenant_id","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_episodic_notes_soft_deleted" ON "episodic_notes" USING btree ("soft_deleted_at");
CREATE TABLE IF NOT EXISTS "escalation_chain_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chain_id" text NOT NULL,
	"customer_id" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"steps_completed" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" text,
	"outcome_reason" text,
	"next_step_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "escalation_chain_runs_tenant_idx" ON "escalation_chain_runs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "escalation_chain_runs_chain_idx" ON "escalation_chain_runs" USING btree ("chain_id");
CREATE INDEX IF NOT EXISTS "escalation_chain_runs_customer_idx" ON "escalation_chain_runs" USING btree ("customer_id");
CREATE INDEX IF NOT EXISTS "escalation_chain_runs_entity_idx" ON "escalation_chain_runs" USING btree ("entity_type","entity_id");
CREATE INDEX IF NOT EXISTS "escalation_chain_runs_status_idx" ON "escalation_chain_runs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "escalation_chain_runs_next_step_at_idx" ON "escalation_chain_runs" USING btree ("next_step_at");
CREATE TABLE IF NOT EXISTS "escalation_chains" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chain_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
CREATE INDEX IF NOT EXISTS "escalation_chains_tenant_idx" ON "escalation_chains" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "escalation_chains_chain_code_tenant_idx" ON "escalation_chains" USING btree ("tenant_id","chain_code");
CREATE INDEX IF NOT EXISTS "escalation_chains_category_idx" ON "escalation_chains" USING btree ("category");
CREATE TABLE IF NOT EXISTS "event_dead_letter" (
	"id" text PRIMARY KEY NOT NULL,
	"original_event_id" text NOT NULL,
	"tenant_id" text,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"failure_reason" text NOT NULL,
	"failure_details" jsonb,
	"retry_history" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"original_created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_notes" text
);
CREATE INDEX IF NOT EXISTS "event_dead_letter_tenant_idx" ON "event_dead_letter" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "event_dead_letter_event_type_idx" ON "event_dead_letter" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "event_dead_letter_aggregate_idx" ON "event_dead_letter" USING btree ("aggregate_type","aggregate_id");
CREATE INDEX IF NOT EXISTS "event_dead_letter_created_at_idx" ON "event_dead_letter" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "event_dead_letter_unresolved_idx" ON "event_dead_letter" USING btree ("resolved_at");
CREATE TABLE IF NOT EXISTS "event_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"sequence_number" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"priority" "event_priority" DEFAULT 'normal' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"trace_id" text,
	"span_id" text,
	"correlation_id" text,
	"causation_id" text,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"lock_expires_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "event_outbox_tenant_idx" ON "event_outbox" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "event_outbox_status_idx" ON "event_outbox" USING btree ("status");
CREATE INDEX IF NOT EXISTS "event_outbox_status_created_idx" ON "event_outbox" USING btree ("status","created_at");
CREATE INDEX IF NOT EXISTS "event_outbox_aggregate_idx" ON "event_outbox" USING btree ("aggregate_type","aggregate_id");
CREATE INDEX IF NOT EXISTS "event_outbox_event_type_idx" ON "event_outbox" USING btree ("event_type");
CREATE INDEX IF NOT EXISTS "event_outbox_next_retry_idx" ON "event_outbox" USING btree ("next_retry_at");
CREATE INDEX IF NOT EXISTS "event_outbox_priority_status_idx" ON "event_outbox" USING btree ("priority","status");
CREATE INDEX IF NOT EXISTS "event_outbox_correlation_idx" ON "event_outbox" USING btree ("correlation_id");
CREATE INDEX IF NOT EXISTS "event_outbox_lock_idx" ON "event_outbox" USING btree ("locked_by","lock_expires_at");
CREATE INDEX IF NOT EXISTS "event_outbox_event_type_status_created_idx" ON "event_outbox" USING btree ("event_type","status","created_at");
CREATE TABLE IF NOT EXISTS "event_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"subscriber_id" text NOT NULL,
	"subscriber_name" text NOT NULL,
	"event_pattern" text NOT NULL,
	"aggregate_pattern" text,
	"endpoint" text NOT NULL,
	"endpoint_type" text DEFAULT 'http' NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"max_events_per_second" integer DEFAULT 100,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "event_subscriptions_tenant_idx" ON "event_subscriptions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "event_subscriptions_subscriber_idx" ON "event_subscriptions" USING btree ("subscriber_id");
CREATE INDEX IF NOT EXISTS "event_subscriptions_pattern_idx" ON "event_subscriptions" USING btree ("event_pattern");
CREATE INDEX IF NOT EXISTS "event_subscriptions_active_idx" ON "event_subscriptions" USING btree ("is_active");
CREATE TABLE IF NOT EXISTS "exception_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"priority" text DEFAULT 'P2' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"amount_minor_units" bigint,
	"due_at" timestamp with time zone,
	"strategic_weight" integer DEFAULT 0 NOT NULL,
	"recommended_action" text,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_decision" text,
	"resolution_note" text,
	"resolved_by_user_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_exception_inbox_tenant_status" ON "exception_inbox" USING btree ("tenant_id","status","priority");
CREATE INDEX IF NOT EXISTS "idx_exception_inbox_domain" ON "exception_inbox" USING btree ("tenant_id","domain","created_at");
CREATE TABLE IF NOT EXISTS "executive_briefings" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"cadence" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"headline" text NOT NULL,
	"portfolio_health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"wins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus_next_period" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_markdown" text NOT NULL,
	"voice_audio_url" text,
	"generated_by" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_executive_briefings_tenant" ON "executive_briefings" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "idx_executive_briefings_cadence" ON "executive_briefings" USING btree ("tenant_id","cadence","period_end");
CREATE TABLE IF NOT EXISTS "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"flag_key" text NOT NULL,
	"description" text,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_flag_key_unique" UNIQUE("flag_key")
);
CREATE INDEX IF NOT EXISTS "idx_feature_flags_key" ON "feature_flags" USING btree ("flag_key");
CREATE TABLE IF NOT EXISTS "field_encryption_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"table_name" text NOT NULL,
	"column_name" text NOT NULL,
	"row_id" text,
	"key_version" integer NOT NULL,
	"encrypted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_field_encryption_audit_scope" ON "field_encryption_audit" USING btree ("tenant_id","table_name","column_name","key_version");
CREATE INDEX IF NOT EXISTS "idx_field_encryption_audit_row" ON "field_encryption_audit" USING btree ("table_name","row_id","encrypted_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_field_encryption_audit_time" ON "field_encryption_audit" USING btree ("encrypted_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "gdpr_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_by" text,
	"executed_at" timestamp with time zone,
	"rejected_reason" text,
	"pseudonym_id" text,
	"affected_tables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_gdpr_reqs_tenant" ON "gdpr_deletion_requests" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_gdpr_reqs_customer" ON "gdpr_deletion_requests" USING btree ("tenant_id","customer_id");
CREATE INDEX IF NOT EXISTS "idx_gdpr_reqs_status" ON "gdpr_deletion_requests" USING btree ("status");
CREATE TABLE IF NOT EXISTS "geo_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"geo_node_id" text NOT NULL,
	"user_id" text,
	"worker_tag_key" text,
	"responsibility" text NOT NULL,
	"inherits" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "geo_assignments_org_idx" ON "geo_assignments" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "geo_assignments_node_idx" ON "geo_assignments" USING btree ("geo_node_id");
CREATE INDEX IF NOT EXISTS "geo_assignments_user_idx" ON "geo_assignments" USING btree ("user_id");
CREATE TABLE IF NOT EXISTS "geo_label_types" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"depth" integer NOT NULL,
	"singular" text NOT NULL,
	"plural" text NOT NULL,
	"color" text,
	"allows_polygon" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "geo_label_types_org_idx" ON "geo_label_types" USING btree ("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "geo_label_types_org_depth_idx" ON "geo_label_types" USING btree ("organization_id","depth");
CREATE TABLE IF NOT EXISTS "geo_node_closure" (
	"ancestor_id" text NOT NULL,
	"descendant_id" text NOT NULL,
	"depth" integer NOT NULL,
	CONSTRAINT "geo_node_closure_ancestor_id_descendant_id_pk" PRIMARY KEY("ancestor_id","descendant_id")
);
CREATE INDEX IF NOT EXISTS "geo_node_closure_descendant_idx" ON "geo_node_closure" USING btree ("descendant_id");
CREATE TABLE IF NOT EXISTS "geo_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"parent_id" text,
	"label_type_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"polygon" jsonb,
	"centroid" jsonb,
	"color_override" text,
	"order_index" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "geo_nodes_org_idx" ON "geo_nodes" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "geo_nodes_parent_idx" ON "geo_nodes" USING btree ("parent_id");
CREATE INDEX IF NOT EXISTS "geo_nodes_label_type_idx" ON "geo_nodes" USING btree ("label_type_id");
CREATE UNIQUE INDEX IF NOT EXISTS "geo_nodes_org_parent_name_idx" ON "geo_nodes" USING btree ("organization_id","parent_id","name");
CREATE TABLE IF NOT EXISTS "handoff_packets" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"event_id" text NOT NULL,
	"source_persona_id" text NOT NULL,
	"target_persona_id" text NOT NULL,
	"objective" text NOT NULL,
	"output_format" text NOT NULL,
	"context_summary" text NOT NULL,
	"latest_user_message" text,
	"relevant_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prior_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_tools" text[] DEFAULT '{}',
	"visibility_scope" "visibility_scope" NOT NULL,
	"tokens_so_far" integer DEFAULT 0 NOT NULL,
	"token_budget" integer NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "handoff_packets_tenant_idx" ON "handoff_packets" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "handoff_packets_thread_idx" ON "handoff_packets" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "handoff_packets_source_idx" ON "handoff_packets" USING btree ("source_persona_id");
CREATE INDEX IF NOT EXISTS "handoff_packets_target_idx" ON "handoff_packets" USING btree ("target_persona_id");
CREATE TABLE IF NOT EXISTS "identity_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"full_name" text,
	"first_name" text,
	"last_name" text,
	"middle_name" text,
	"date_of_birth" timestamp with time zone,
	"nationality" text,
	"gender" text,
	"primary_id_type" text,
	"primary_id_number" text,
	"primary_id_expires_at" timestamp with time zone,
	"secondary_ids" jsonb DEFAULT '[]'::jsonb,
	"verified_address" jsonb DEFAULT '{}'::jsonb,
	"verified_employer" text,
	"verified_position" text,
	"verified_income" integer,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"verification_level" integer DEFAULT 0 NOT NULL,
	"consistency_score" numeric(5, 4),
	"consistency_issues" jsonb DEFAULT '[]'::jsonb,
	"fraud_risk_level" "fraud_risk_level" DEFAULT 'low' NOT NULL,
	"fraud_risk_score" numeric(5, 4) DEFAULT '0',
	"fraud_indicators" jsonb DEFAULT '[]'::jsonb,
	"potential_duplicates" jsonb DEFAULT '[]'::jsonb,
	"watchlist_checked_at" timestamp with time zone,
	"watchlist_status" text DEFAULT 'not_checked',
	"watchlist_matches" jsonb DEFAULT '[]'::jsonb,
	"source_documents" jsonb DEFAULT '[]'::jsonb,
	"last_review_at" timestamp with time zone,
	"last_review_by" text,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text
);
CREATE INDEX IF NOT EXISTS "identity_profiles_tenant_idx" ON "identity_profiles" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "identity_profiles_customer_idx" ON "identity_profiles" USING btree ("tenant_id","customer_id");
CREATE INDEX IF NOT EXISTS "identity_profiles_verification_status_idx" ON "identity_profiles" USING btree ("verification_status");
CREATE INDEX IF NOT EXISTS "identity_profiles_fraud_risk_level_idx" ON "identity_profiles" USING btree ("fraud_risk_level");
CREATE INDEX IF NOT EXISTS "identity_profiles_primary_id_number_idx" ON "identity_profiles" USING btree ("tenant_id","primary_id_number");
CREATE TABLE IF NOT EXISTS "implicit_feedback_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"agent_action_id" text,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"surface" text NOT NULL,
	"signal_type" text NOT NULL,
	"strength" real NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_implicit_feedback_trace" ON "implicit_feedback_signals" USING btree ("trace_id");
CREATE INDEX IF NOT EXISTS "idx_implicit_feedback_user_time" ON "implicit_feedback_signals" USING btree ("tenant_id","user_id","emitted_at");
CREATE INDEX IF NOT EXISTS "idx_implicit_feedback_type" ON "implicit_feedback_signals" USING btree ("tenant_id","signal_type","emitted_at");
CREATE TABLE IF NOT EXISTS "improvement_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"metric" text NOT NULL,
	"period_kind" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"confidence_low" double precision,
	"confidence_high" double precision,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_improvement_snapshots" ON "improvement_snapshots" USING btree ("tenant_id","metric","period_kind","period_start");
CREATE INDEX IF NOT EXISTS "idx_improvement_snapshots_tenant_metric" ON "improvement_snapshots" USING btree ("tenant_id","metric","period_start");
CREATE TABLE IF NOT EXISTS "interactive_report_action_acks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"interactive_report_version_id" text NOT NULL,
	"action_plan_id" text NOT NULL,
	"resolution" text NOT NULL,
	"resolution_ref_id" text,
	"acknowledged_by" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS "interactive_report_action_acks_tenant_idx" ON "interactive_report_action_acks" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "interactive_report_action_acks_version_idx" ON "interactive_report_action_acks" USING btree ("interactive_report_version_id");
CREATE TABLE IF NOT EXISTS "interactive_report_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"report_instance_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"render_kind" "interactive_report_render_kind" DEFAULT 'html_bundle' NOT NULL,
	"media_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"action_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signed_url" text,
	"signed_url_key" text,
	"expires_at" timestamp with time zone,
	"content_hash" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "interactive_report_versions_tenant_idx" ON "interactive_report_versions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "interactive_report_versions_report_instance_idx" ON "interactive_report_versions" USING btree ("report_instance_id");
CREATE INDEX IF NOT EXISTS "interactive_report_versions_render_kind_idx" ON "interactive_report_versions" USING btree ("render_kind");
CREATE TABLE IF NOT EXISTS "invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"platform_tenant_id" text NOT NULL,
	"issued_by" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"max_redemptions" integer,
	"redemptions_used" integer DEFAULT 0 NOT NULL,
	"default_role_id" text NOT NULL,
	"attachment_hints" jsonb,
	"revoked_at" timestamp with time zone,
	"revoked_by" text
);
CREATE INDEX IF NOT EXISTS "invite_codes_org_idx" ON "invite_codes" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "invite_codes_platform_tenant_idx" ON "invite_codes" USING btree ("platform_tenant_id");
CREATE INDEX IF NOT EXISTS "invite_codes_issued_by_idx" ON "invite_codes" USING btree ("issued_by");
CREATE INDEX IF NOT EXISTS "invite_codes_expires_at_idx" ON "invite_codes" USING btree ("expires_at");
CREATE TABLE IF NOT EXISTS "kernel_action_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"goal_id" text NOT NULL,
	"step_id" text NOT NULL,
	"tool_name" text,
	"decision" text NOT NULL,
	"payload_hash" text NOT NULL,
	"outcome" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"latency_ms" double precision,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_kernel_action_audit_tenant_time" ON "kernel_action_audit" USING btree ("tenant_id","captured_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_kernel_action_audit_goal" ON "kernel_action_audit" USING btree ("goal_id");
CREATE INDEX IF NOT EXISTS "idx_kernel_action_audit_step" ON "kernel_action_audit" USING btree ("step_id");
CREATE TABLE IF NOT EXISTS "kernel_cot_reservoir" (
	"thought_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"thread_id" text NOT NULL,
	"stakes" "kernel_stakes" NOT NULL,
	"thought_text" text NOT NULL,
	"prompt_hash" text,
	"response_hash" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_kernel_cot_tenant_time" ON "kernel_cot_reservoir" USING btree ("tenant_id","captured_at");
CREATE INDEX IF NOT EXISTS "idx_kernel_cot_thread" ON "kernel_cot_reservoir" USING btree ("thread_id");
CREATE TABLE IF NOT EXISTS "kernel_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thought_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"signal" text NOT NULL,
	"rating" integer,
	"correction_text" text,
	"category" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_kernel_feedback_tenant_user" ON "kernel_feedback" USING btree ("tenant_id","user_id","captured_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_kernel_feedback_thought" ON "kernel_feedback" USING btree ("thought_id");
CREATE INDEX IF NOT EXISTS "idx_kernel_feedback_signal" ON "kernel_feedback" USING btree ("tenant_id","signal");
CREATE TABLE IF NOT EXISTS "kernel_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps_total" integer DEFAULT 0 NOT NULL,
	"steps_done" integer DEFAULT 0 NOT NULL,
	"stall_reason" text,
	"stalled_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_kernel_goals_tenant_user_status" ON "kernel_goals" USING btree ("tenant_id","user_id","status","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_kernel_goals_thread" ON "kernel_goals" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "idx_kernel_goals_stalled_at" ON "kernel_goals" USING btree ("stalled_at");
CREATE TABLE IF NOT EXISTS "kernel_memory_episodic" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"turn_id" text NOT NULL,
	"kind" "kernel_memory_episodic_kind" NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_episodic_tenant_user_time" ON "kernel_memory_episodic" USING btree ("tenant_id","user_id","captured_at");
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_episodic_thread" ON "kernel_memory_episodic" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_episodic_expires" ON "kernel_memory_episodic" USING btree ("expires_at");
CREATE TABLE IF NOT EXISTS "kernel_memory_procedural" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text NOT NULL,
	"pattern_name" text NOT NULL,
	"tool_sequence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invocations" integer DEFAULT 0 NOT NULL,
	"successes" integer DEFAULT 0 NOT NULL,
	"last_invoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_kernel_mem_procedural_tenant_user_pattern" ON "kernel_memory_procedural" USING btree ("tenant_id","user_id","pattern_name");
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_procedural_tenant_user" ON "kernel_memory_procedural" USING btree ("tenant_id","user_id");
CREATE TABLE IF NOT EXISTS "kernel_memory_reflective" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text,
	"period_kind" "kernel_memory_reflective_period" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"top_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sentiment_avg" real,
	"action_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_reflective_tenant_user_period_start" ON "kernel_memory_reflective" USING btree ("tenant_id","user_id","period_kind","period_start");
CREATE TABLE IF NOT EXISTS "kernel_memory_semantic" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"user_id" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_turn_id" text,
	"evidence_count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"source" "kernel_memory_semantic_source" DEFAULT 'extracted' NOT NULL,
	"embedding" vector(1536),
	"last_embedded_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_kernel_mem_semantic_tenant_user_key" ON "kernel_memory_semantic" USING btree ("tenant_id","user_id","key");
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_semantic_tenant_time" ON "kernel_memory_semantic" USING btree ("tenant_id","last_seen_at");
CREATE INDEX IF NOT EXISTS "idx_kernel_mem_semantic_last_embedded" ON "kernel_memory_semantic" USING btree ("tenant_id","last_embedded_at");
CREATE TABLE IF NOT EXISTS "kernel_persona_drift_events" (
	"id" text PRIMARY KEY NOT NULL,
	"thought_id" text NOT NULL,
	"tenant_id" text,
	"persona_id" text NOT NULL,
	"violation_type" "persona_drift_violation" NOT NULL,
	"severity" "persona_drift_severity" NOT NULL,
	"excerpt" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_kernel_drift_tenant_time" ON "kernel_persona_drift_events" USING btree ("tenant_id","detected_at");
CREATE INDEX IF NOT EXISTS "idx_kernel_drift_persona_severity" ON "kernel_persona_drift_events" USING btree ("persona_id","severity");
CREATE TABLE IF NOT EXISTS "kernel_prompt_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"capability" text NOT NULL,
	"version" text NOT NULL,
	"prompt_text" text NOT NULL,
	"golden_set_version" text NOT NULL,
	"status" text DEFAULT 'shadow' NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "uq_kernel_prompt_registry_capability_version" UNIQUE("capability","version")
);
CREATE INDEX IF NOT EXISTS "idx_kernel_prompt_registry_capability_status" ON "kernel_prompt_registry" USING btree ("capability","status");
CREATE INDEX IF NOT EXISTS "idx_kernel_prompt_registry_promoted_at" ON "kernel_prompt_registry" USING btree ("promoted_at");
CREATE TABLE IF NOT EXISTS "kernel_provenance" (
	"thought_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"thread_id" text NOT NULL,
	"scope_kind" "kernel_scope_kind" NOT NULL,
	"tier" "kernel_tier" NOT NULL,
	"stakes" "kernel_stakes" NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text NOT NULL,
	"sensor_id" text NOT NULL,
	"model_id" text NOT NULL,
	"cache_hit" text NOT NULL,
	"judge_score" double precision,
	"cohort_fingerprints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tool_call_summaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" double precision NOT NULL,
	"produced_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_kernel_prov_tenant_time" ON "kernel_provenance" USING btree ("tenant_id","produced_at");
CREATE INDEX IF NOT EXISTS "idx_kernel_prov_thread" ON "kernel_provenance" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "idx_kernel_prov_sensor" ON "kernel_provenance" USING btree ("sensor_id");
CREATE TABLE IF NOT EXISTS "market_data_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"query_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_market_data_cache_provider" ON "market_data_cache" USING btree ("provider");
CREATE INDEX IF NOT EXISTS "idx_market_data_cache_expires" ON "market_data_cache" USING btree ("expires_at");
CREATE TABLE IF NOT EXISTS "mdr_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"horizon" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"proposed_by" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"start_date" text,
	"due_date" text,
	"owner_editable" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_mdr_plan_tenant_horizon" ON "mdr_plan_items" USING btree ("tenant_id","horizon");
CREATE INDEX IF NOT EXISTS "idx_mdr_plan_tenant_parent" ON "mdr_plan_items" USING btree ("tenant_id","parent_id");
CREATE INDEX IF NOT EXISTS "idx_mdr_plan_status" ON "mdr_plan_items" USING btree ("tenant_id","status");
CREATE TABLE IF NOT EXISTS "memory_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_memory_blocks_tenant_session_kind" ON "memory_blocks" USING btree ("tenant_id","session_id","kind");
CREATE INDEX IF NOT EXISTS "idx_memory_blocks_tenant_session_updated" ON "memory_blocks" USING btree ("tenant_id","session_id","updated_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "message_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text,
	"template_id" text,
	"message_ref" text NOT NULL,
	"channel" "message_channel" NOT NULL,
	"recipient_name" text,
	"recipient_address" text NOT NULL,
	"recipient_type" text DEFAULT 'customer',
	"subject" text,
	"content" text NOT NULL,
	"html_content" text,
	"variables" jsonb DEFAULT '{}'::jsonb,
	"language" text DEFAULT 'en',
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"trigger_type" text,
	"trigger_entity_type" text,
	"trigger_entity_id" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_by" text,
	"provider" text,
	"provider_message_id" text,
	"provider_response" jsonb DEFAULT '{}'::jsonb,
	"cost" integer,
	"cost_currency" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3,
	"last_retry_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"failure_code" text,
	"expires_at" timestamp with time zone,
	"priority" integer DEFAULT 5,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
CREATE INDEX IF NOT EXISTS "message_instances_tenant_idx" ON "message_instances" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "message_instances_message_ref_tenant_idx" ON "message_instances" USING btree ("tenant_id","message_ref");
CREATE INDEX IF NOT EXISTS "message_instances_customer_idx" ON "message_instances" USING btree ("customer_id");
CREATE INDEX IF NOT EXISTS "message_instances_template_idx" ON "message_instances" USING btree ("template_id");
CREATE INDEX IF NOT EXISTS "message_instances_channel_idx" ON "message_instances" USING btree ("channel");
CREATE INDEX IF NOT EXISTS "message_instances_status_idx" ON "message_instances" USING btree ("status");
CREATE INDEX IF NOT EXISTS "message_instances_scheduled_at_idx" ON "message_instances" USING btree ("scheduled_at");
CREATE INDEX IF NOT EXISTS "message_instances_sent_at_idx" ON "message_instances" USING btree ("sent_at");
CREATE INDEX IF NOT EXISTS "message_instances_provider_message_idx" ON "message_instances" USING btree ("provider","provider_message_id");
CREATE INDEX IF NOT EXISTS "message_instances_trigger_entity_idx" ON "message_instances" USING btree ("trigger_entity_type","trigger_entity_id");
CREATE TABLE IF NOT EXISTS "message_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"template_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "template_category" NOT NULL,
	"status" "template_status" DEFAULT 'draft' NOT NULL,
	"supported_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"whatsapp_content" jsonb DEFAULT '{}'::jsonb,
	"sms_content" text,
	"email_subject" text,
	"email_html_content" text,
	"email_text_content" text,
	"push_title" text,
	"push_body" text,
	"voice_script" text,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"required_variables" jsonb DEFAULT '[]'::jsonb,
	"default_language" text DEFAULT 'en',
	"translations" jsonb DEFAULT '{}'::jsonb,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approval_level" text,
	"quiet_hours_exempt" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_version_id" text,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
CREATE INDEX IF NOT EXISTS "message_templates_tenant_idx" ON "message_templates" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_code_tenant_idx" ON "message_templates" USING btree ("tenant_id","template_code");
CREATE INDEX IF NOT EXISTS "message_templates_category_idx" ON "message_templates" USING btree ("category");
CREATE INDEX IF NOT EXISTS "message_templates_status_idx" ON "message_templates" USING btree ("status");
CREATE TABLE IF NOT EXISTS "migration_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"created_by" text NOT NULL,
	"status" "migration_run_status" DEFAULT 'uploaded' NOT NULL,
	"upload_filename" text,
	"upload_mime_type" text,
	"upload_size_bytes" integer,
	"extraction_summary" jsonb,
	"diff_summary" jsonb,
	"committed_summary" jsonb,
	"bundle" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"committed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "migration_runs_tenant_idx" ON "migration_runs" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "migration_runs_status_idx" ON "migration_runs" USING btree ("status");
CREATE INDEX IF NOT EXISTS "migration_runs_tenant_status_idx" ON "migration_runs" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "migration_runs_created_at_idx" ON "migration_runs" USING btree ("created_at");
CREATE TABLE IF NOT EXISTS "module_update_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"capture_id" text NOT NULL,
	"module_template_id" text NOT NULL,
	"action" text NOT NULL,
	"persona_id" text NOT NULL,
	"status" text DEFAULT 'pending_hitl' NOT NULL,
	"confidence" double precision NOT NULL,
	"hitl_required" boolean DEFAULT true NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"matrix_row_id" text,
	"approver_tier" integer,
	"approver_user_id" text,
	"decline_reason" text,
	"edited_from_id" text,
	"failure_reason" text,
	"resolved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "module_update_proposals_tenant_status_idx" ON "module_update_proposals" USING btree ("tenant_id","status","created_at");
CREATE INDEX IF NOT EXISTS "module_update_proposals_tenant_module_idx" ON "module_update_proposals" USING btree ("tenant_id","module_template_id");
CREATE INDEX IF NOT EXISTS "module_update_proposals_capture_idx" ON "module_update_proposals" USING btree ("capture_id");
CREATE INDEX IF NOT EXISTS "module_update_proposals_tenant_persona_idx" ON "module_update_proposals" USING btree ("tenant_id","persona_id");
CREATE TABLE IF NOT EXISTS "monthly_close_run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"step_name" text NOT NULL,
	"step_index" integer NOT NULL,
	"decision" text NOT NULL,
	"actor" text DEFAULT 'system' NOT NULL,
	"policy_rule" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_close_run_steps_decision_chk" CHECK ("monthly_close_run_steps"."decision" IN ('executed', 'auto_approved', 'awaiting_approval', 'approved', 'skipped', 'failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_monthly_close_run_steps_run_step" ON "monthly_close_run_steps" USING btree ("run_id","step_name");
CREATE INDEX IF NOT EXISTS "idx_monthly_close_run_steps_tenant_run" ON "monthly_close_run_steps" USING btree ("tenant_id","run_id");
CREATE INDEX IF NOT EXISTS "idx_monthly_close_run_steps_run_index" ON "monthly_close_run_steps" USING btree ("run_id","step_index");
CREATE TABLE IF NOT EXISTS "monthly_close_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'cron' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"triggered_by" text DEFAULT 'system' NOT NULL,
	"reconciled_payments" integer DEFAULT 0 NOT NULL,
	"statements_generated" integer DEFAULT 0 NOT NULL,
	"kra_mri_total_minor" bigint DEFAULT 0 NOT NULL,
	"disbursement_total_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text,
	"summary_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_close_runs_status_chk" CHECK ("monthly_close_runs"."status" IN ('running', 'awaiting_approval', 'completed', 'failed', 'skipped')),
	CONSTRAINT "monthly_close_runs_period_chk" CHECK ("monthly_close_runs"."period_month" BETWEEN 1 AND 12 AND "monthly_close_runs"."period_year" BETWEEN 2020 AND 2100)
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_monthly_close_runs_tenant_period" ON "monthly_close_runs" USING btree ("tenant_id","period_year","period_month");
CREATE INDEX IF NOT EXISTS "idx_monthly_close_runs_tenant_status" ON "monthly_close_runs" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_monthly_close_runs_tenant_started" ON "monthly_close_runs" USING btree ("tenant_id","started_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "ocr_extractions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"document_upload_id" text NOT NULL,
	"processing_started_at" timestamp with time zone,
	"processing_completed_at" timestamp with time zone,
	"processing_duration_ms" integer,
	"ocr_provider" text NOT NULL,
	"provider_response" jsonb DEFAULT '{}'::jsonb,
	"extracted_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_scores" jsonb DEFAULT '{}'::jsonb,
	"overall_confidence" numeric(5, 4),
	"raw_text" text,
	"validation_status" text DEFAULT 'pending',
	"validation_errors" jsonb DEFAULT '[]'::jsonb,
	"manual_corrections" jsonb DEFAULT '{}'::jsonb,
	"corrected_at" timestamp with time zone,
	"corrected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ocr_extractions_tenant_idx" ON "ocr_extractions" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "ocr_extractions_document_upload_idx" ON "ocr_extractions" USING btree ("document_upload_id");
CREATE INDEX IF NOT EXISTS "ocr_extractions_provider_idx" ON "ocr_extractions" USING btree ("ocr_provider");
CREATE INDEX IF NOT EXISTS "ocr_extractions_validation_status_idx" ON "ocr_extractions" USING btree ("validation_status");
CREATE TABLE IF NOT EXISTS "org_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_identity_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"platform_tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "org_membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"nickname" text,
	"joined_via_invite_code" text,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"block_reason" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "org_memberships_identity_org_idx" ON "org_memberships" USING btree ("tenant_identity_id","organization_id");
CREATE INDEX IF NOT EXISTS "org_memberships_identity_idx" ON "org_memberships" USING btree ("tenant_identity_id");
CREATE INDEX IF NOT EXISTS "org_memberships_org_idx" ON "org_memberships" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "org_memberships_platform_tenant_idx" ON "org_memberships" USING btree ("platform_tenant_id");
CREATE INDEX IF NOT EXISTS "org_memberships_user_idx" ON "org_memberships" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "org_memberships_status_idx" ON "org_memberships" USING btree ("status");
CREATE TABLE IF NOT EXISTS "owner_dashboard_layout" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tile_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hidden_tiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sidebar_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text DEFAULT 'owner' NOT NULL,
	CONSTRAINT "owner_dashboard_layout_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
CREATE TABLE IF NOT EXISTS "owner_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_tenant_id" uuid,
	"installed_by_tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"prompt_template" text NOT NULL,
	"tool_allowlist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trigger_kind" text NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"run_count" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_owner_skills_installer_slug" ON "owner_skills" USING btree ("installed_by_tenant_id","slug");
CREATE INDEX IF NOT EXISTS "idx_owner_skills_trigger_kind" ON "owner_skills" USING btree ("installed_by_tenant_id","trigger_kind");
CREATE INDEX IF NOT EXISTS "idx_owner_skills_enabled" ON "owner_skills" USING btree ("installed_by_tenant_id","enabled");
CREATE TABLE IF NOT EXISTS "persona_branding" (
	"tenant_id" text NOT NULL,
	"surface" text DEFAULT '' NOT NULL,
	"display_name" text,
	"opening_preamble" text,
	"voice_profile_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "persona_branding_tenant_id_surface_pk" PRIMARY KEY("tenant_id","surface")
);
CREATE TABLE IF NOT EXISTS "platform_feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"flag_name" text NOT NULL,
	"flag_value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"last_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_set_by" text NOT NULL,
	CONSTRAINT "uq_platform_feature_flags_scope_flag" UNIQUE("scope","flag_name")
);
CREATE INDEX IF NOT EXISTS "idx_platform_feature_flags_flag_name" ON "platform_feature_flags" USING btree ("flag_name");
CREATE INDEX IF NOT EXISTS "idx_platform_feature_flags_scope" ON "platform_feature_flags" USING btree ("scope");
CREATE TABLE IF NOT EXISTS "platform_killswitch_state" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"level" text NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"prev_level" text,
	"prev_reason_code" text,
	"prev_note" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"set_by" text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_killswitch_state_scope" ON "platform_killswitch_state" USING btree ("scope");
CREATE INDEX IF NOT EXISTS "idx_platform_killswitch_state_set_at" ON "platform_killswitch_state" USING btree ("set_at");
CREATE TABLE IF NOT EXISTS "platform_privacy_budget" (
	"id" text PRIMARY KEY NOT NULL,
	"total_epsilon" double precision NOT NULL,
	"spent_epsilon" double precision DEFAULT 0 NOT NULL,
	"total_delta" double precision NOT NULL,
	"spent_delta" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "platform_privacy_budget_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"epsilon" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_platform_privacy_budget_reservations_reserved_at" ON "platform_privacy_budget_reservations" USING btree ("reserved_at");
CREATE TABLE IF NOT EXISTS "portal_layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"user_id" text,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"layout" jsonb NOT NULL,
	"parent_layout_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_portal_layouts_tenant_persona_user" ON "portal_layouts" USING btree ("tenant_id","persona_id","user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_portal_layouts_tenant_persona_user" ON "portal_layouts" USING btree ("tenant_id","persona_id","user_id");
CREATE INDEX IF NOT EXISTS "idx_portal_layouts_parent" ON "portal_layouts" USING btree ("parent_layout_id");
CREATE TABLE IF NOT EXISTS "presentation_themes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"slide_master_jsonb" jsonb NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_presentation_themes_slug_nonempty" CHECK (length("presentation_themes"."slug") > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_presentation_themes_platform_slug" ON "presentation_themes" USING btree ("slug") WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_presentation_themes_tenant_slug" ON "presentation_themes" USING btree ("tenant_id","slug") WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_presentation_themes_tenant" ON "presentation_themes" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "privacy_budget_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"tier" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"total_epsilon" double precision NOT NULL,
	"total_delta" double precision NOT NULL,
	"spent_epsilon" double precision DEFAULT 0 NOT NULL,
	"spent_delta" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_privacy_budget_tenant_window" ON "privacy_budget_ledger" USING btree ("tenant_id","window_start");
CREATE INDEX IF NOT EXISTS "idx_privacy_budget_ledger_tenant" ON "privacy_budget_ledger" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "privacy_budget_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"query_id" text NOT NULL,
	"epsilon" double precision NOT NULL,
	"delta" double precision NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"spent_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_privacy_budget_spend_tenant" ON "privacy_budget_spend" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_privacy_budget_spend_spent_at" ON "privacy_budget_spend" USING btree ("spent_at");
CREATE TABLE IF NOT EXISTS "process_observations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"process_kind" text NOT NULL,
	"process_instance_id" text NOT NULL,
	"stage" text NOT NULL,
	"previous_stage" text,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"variant" text DEFAULT 'standard' NOT NULL,
	"is_reopen" boolean DEFAULT false NOT NULL,
	"is_stuck" boolean DEFAULT false NOT NULL,
	"duration_ms_from_previous" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_process_obs_tenant_kind_stage" ON "process_observations" USING btree ("tenant_id","process_kind","stage");
CREATE INDEX IF NOT EXISTS "idx_process_obs_instance" ON "process_observations" USING btree ("tenant_id","process_kind","process_instance_id");
CREATE TABLE IF NOT EXISTS "progressive_context_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"version" integer NOT NULL,
	"context" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_context_version" UNIQUE("tenant_id","session_id","version")
);
CREATE INDEX IF NOT EXISTS "idx_context_snap_tenant_session" ON "progressive_context_snapshots" USING btree ("tenant_id","session_id","version");
CREATE INDEX IF NOT EXISTS "idx_context_snap_created" ON "progressive_context_snapshots" USING btree ("tenant_id","created_at");
CREATE TABLE IF NOT EXISTS "reflexion_buffer" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"task_id" text,
	"reflection" text NOT NULL,
	"outcome" text NOT NULL,
	"importance" real DEFAULT 0.5 NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pruned_at" timestamp with time zone,
	"cluster_id" text,
	"retrieved_count" integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_reflexion_per_user" ON "reflexion_buffer" USING btree ("tenant_id","user_id","recorded_at");
CREATE INDEX IF NOT EXISTS "idx_reflexion_active_per_user" ON "reflexion_buffer" USING btree ("tenant_id","user_id","pruned_at","recorded_at");
CREATE TABLE IF NOT EXISTS "reflexion_guidelines" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"slug" text NOT NULL,
	"body" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"source_reflexion_ids" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_reflexion_guidelines_tenant_slug" ON "reflexion_guidelines" USING btree ("tenant_id","slug");
CREATE INDEX IF NOT EXISTS "idx_reflexion_guidelines_per_user_updated" ON "reflexion_guidelines" USING btree ("tenant_id","user_id","updated_at");
CREATE TABLE IF NOT EXISTS "reflexion_lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"task_tag" text NOT NULL,
	"lesson" text NOT NULL,
	"evidence" text NOT NULL,
	"created_at" text NOT NULL,
	"recency_score" double precision DEFAULT 0 NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_reflexion_lessons_tenant_tag_lesson" ON "reflexion_lessons" USING btree ("tenant_id","task_tag","lesson");
CREATE INDEX IF NOT EXISTS "idx_reflexion_lessons_bucket_recency" ON "reflexion_lessons" USING btree ("tenant_id","task_tag","recency_score");
CREATE TABLE IF NOT EXISTS "report_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"slug" text NOT NULL,
	"display_name_en" text NOT NULL,
	"display_name_sw" text,
	"sections_jsonb" jsonb NOT NULL,
	"output_formats" text[] DEFAULT ARRAY['pdf', 'docx', 'pptx']::TEXT[] NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_report_templates_slug_nonempty" CHECK (length("report_templates"."slug") > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_report_templates_platform_slug" ON "report_templates" USING btree ("slug") WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_report_templates_tenant_slug" ON "report_templates" USING btree ("tenant_id","slug") WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_report_templates_tenant" ON "report_templates" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_report_templates_built_in" ON "report_templates" USING btree ("is_built_in");
CREATE TABLE IF NOT EXISTS "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
CREATE INDEX IF NOT EXISTS "roles_tenant_idx" ON "roles" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_tenant_idx" ON "roles" USING btree ("tenant_id","name");
CREATE INDEX IF NOT EXISTS "roles_system_idx" ON "roles" USING btree ("is_system");
CREATE TABLE IF NOT EXISTS "scan_bundle_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"bundle_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"page_number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"quad" jsonb,
	"ocr_text" text,
	"ocr_confidence" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "scan_bundle_pages_bundle_idx" ON "scan_bundle_pages" USING btree ("bundle_id");
CREATE INDEX IF NOT EXISTS "scan_bundle_pages_tenant_idx" ON "scan_bundle_pages" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "scan_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text,
	"purpose" text,
	"status" "scan_bundle_status" DEFAULT 'draft' NOT NULL,
	"assembled_document_id" text,
	"page_count" integer DEFAULT 0 NOT NULL,
	"processing_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "scan_bundles_tenant_idx" ON "scan_bundles" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "scan_bundles_status_idx" ON "scan_bundles" USING btree ("status");
CREATE INDEX IF NOT EXISTS "scan_bundles_created_by_idx" ON "scan_bundles" USING btree ("created_by");
CREATE TABLE IF NOT EXISTS "section_layouts" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"route" text NOT NULL,
	"section_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pinned" text[] DEFAULT '{}' NOT NULL,
	"hidden" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_layouts_tenant_id_user_id_route_pk" PRIMARY KEY("tenant_id","user_id","route")
);
CREATE INDEX IF NOT EXISTS "section_layouts_tenant_route_idx" ON "section_layouts" USING btree ("tenant_id","route");
CREATE INDEX IF NOT EXISTS "section_layouts_tenant_user_updated_idx" ON "section_layouts" USING btree ("tenant_id","user_id","last_updated");
CREATE TABLE IF NOT EXISTS "semantic_cache_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"surface" text NOT NULL,
	"persona_id" text NOT NULL,
	"outcome" text NOT NULL,
	"intent" text NOT NULL,
	"similarity" double precision,
	"threshold" double precision NOT NULL,
	"model_id" text NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"skip_reason" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_semantic_cache_log_tenant_time" ON "semantic_cache_log" USING btree ("tenant_id","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_semantic_cache_log_outcome_time" ON "semantic_cache_log" USING btree ("outcome","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_semantic_cache_log_tenant_outcome" ON "semantic_cache_log" USING btree ("tenant_id","outcome","occurred_at");
CREATE TABLE IF NOT EXISTS "sensor_call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"task" text NOT NULL,
	"sensor" text NOT NULL,
	"model" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"outcome" text NOT NULL,
	"error_class" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost_usd_micro" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"thinking_active" boolean DEFAULT false NOT NULL,
	"decision_trace_id" text
);
CREATE INDEX IF NOT EXISTS "idx_sensor_call_log_tenant_time" ON "sensor_call_log" USING btree ("tenant_id","started_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_sensor_call_log_task_sensor" ON "sensor_call_log" USING btree ("task","sensor","started_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_sensor_call_log_outcome" ON "sensor_call_log" USING btree ("outcome","started_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "sensor_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"display_name" text NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"default_max_budget_usd_micro_per_call" bigint DEFAULT 0 NOT NULL,
	"default_max_tokens" integer DEFAULT 2000 NOT NULL,
	"pricing_input_usd_micro_per_1m" bigint DEFAULT 0 NOT NULL,
	"pricing_output_usd_micro_per_1m" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_sensor_catalog_provider" ON "sensor_catalog" USING btree ("provider");
CREATE INDEX IF NOT EXISTS "idx_sensor_catalog_active_tier" ON "sensor_catalog" USING btree ("active","tier");
CREATE TABLE IF NOT EXISTS "sensorium_event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"surface" text NOT NULL,
	"route" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"emitted_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_sensorium_tenant_user_session" ON "sensorium_event_log" USING btree ("tenant_id","user_id","session_id","emitted_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "idx_sensorium_event_type" ON "sensorium_event_log" USING btree ("event_type");
CREATE TABLE IF NOT EXISTS "session_replay_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"surface" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"storage_uri" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_session_replay_chunks_session_seq" ON "session_replay_chunks" USING btree ("session_id","sequence_number");
CREATE INDEX IF NOT EXISTS "idx_session_replay_chunks_tenant_session" ON "session_replay_chunks" USING btree ("tenant_id","session_id","captured_at");
CREATE INDEX IF NOT EXISTS "idx_session_replay_chunks_tenant_user_time" ON "session_replay_chunks" USING btree ("tenant_id","user_id","captured_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "skill_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"name" text NOT NULL,
	"nl_description" text NOT NULL,
	"description_embedding" vector(1536),
	"tool_call_template" jsonb NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_skill_registry_tenant_code_hash" ON "skill_registry" USING btree ("tenant_id","code_hash");
CREATE INDEX IF NOT EXISTS "idx_skill_registry_tenant_status" ON "skill_registry" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_skill_registry_last_used" ON "skill_registry" USING btree ("last_used_at");
CREATE TABLE IF NOT EXISTS "sovereign_action_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"action_type" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"proposer" text NOT NULL,
	"approvers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"executed_at" timestamp with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"this_hash" text NOT NULL,
	"rollback_payload" jsonb,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_sovereign_action_ledger_tenant_time" ON "sovereign_action_ledger" USING btree ("tenant_id","executed_at","id");
CREATE INDEX IF NOT EXISTS "idx_sovereign_action_ledger_action_type" ON "sovereign_action_ledger" USING btree ("tenant_id","action_type");
CREATE INDEX IF NOT EXISTS "idx_sovereign_action_ledger_this_hash" ON "sovereign_action_ledger" USING btree ("this_hash");
CREATE TABLE IF NOT EXISTS "sovereign_approvals" (
	"action_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"proposer_user_id" text NOT NULL,
	"thought_id" text NOT NULL,
	"summary" text NOT NULL,
	"tool_name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stakes" "sovereign_approval_stakes" NOT NULL,
	"status" "sovereign_approval_status" NOT NULL,
	"signatures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_sovereign_approvals_tenant_status" ON "sovereign_approvals" USING btree ("tenant_id","status");
CREATE INDEX IF NOT EXISTS "idx_sovereign_approvals_proposer" ON "sovereign_approvals" USING btree ("proposer_user_id");
CREATE INDEX IF NOT EXISTS "idx_sovereign_approvals_expires" ON "sovereign_approvals" USING btree ("expires_at");
CREATE TABLE IF NOT EXISTS "sub_md_slo_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_md" text NOT NULL,
	"tenant_id" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"metric" text NOT NULL,
	"actual_value" numeric(14, 6) NOT NULL,
	"predicted_value" numeric(14, 6),
	"delta" numeric(14, 6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_sub_md_slo_events_sub_md_time" ON "sub_md_slo_events" USING btree ("sub_md","metric","timestamp");
CREATE INDEX IF NOT EXISTS "idx_sub_md_slo_events_tenant_time" ON "sub_md_slo_events" USING btree ("tenant_id","timestamp");
CREATE TABLE IF NOT EXISTS "sub_md_slos" (
	"sub_md" text NOT NULL,
	"tenant_id" text,
	"metric" text NOT NULL,
	"target" numeric(12, 6) NOT NULL,
	"window" text NOT NULL,
	"breach_action" text NOT NULL,
	"canary_stage" text DEFAULT 'shadow' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_md_slos_sub_md_tenant_id_metric_pk" PRIMARY KEY("sub_md","tenant_id","metric"),
	CONSTRAINT "sub_md_slos_breach_action_chk" CHECK ("sub_md_slos"."breach_action" IN ('warn', 'reduce-traffic', 'handoff', 'kill-and-rollback')),
	CONSTRAINT "sub_md_slos_window_chk" CHECK ("sub_md_slos"."window" IN ('rolling-24h', 'rolling-7d', 'rolling-30d')),
	CONSTRAINT "sub_md_slos_canary_stage_chk" CHECK ("sub_md_slos"."canary_stage" IN ('shadow', 'canary-1pct', 'canary-5pct', 'canary-25pct', 'live')),
	CONSTRAINT "sub_md_slos_metric_chk" CHECK ("sub_md_slos"."metric" IN ('resolution-quality', 'task-completion-rate', 'owner-cs-score', 'cost-per-resolution'))
);
CREATE INDEX IF NOT EXISTS "idx_sub_md_slos_metric" ON "sub_md_slos" USING btree ("sub_md","metric");
CREATE INDEX IF NOT EXISTS "idx_sub_md_slos_tenant" ON "sub_md_slos" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_sub_md_slos_canary" ON "sub_md_slos" USING btree ("canary_stage");
CREATE TABLE IF NOT EXISTS "tab_event_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"capture_id" text,
	"proposal_id" text,
	"module_template_id" text,
	"persona_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"actor" text NOT NULL,
	"transport" text DEFAULT 'api' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "tab_event_log_tenant_created_idx" ON "tab_event_log" USING btree ("tenant_id","created_at");
CREATE INDEX IF NOT EXISTS "tab_event_log_proposal_idx" ON "tab_event_log" USING btree ("proposal_id","sequence");
CREATE INDEX IF NOT EXISTS "tab_event_log_kind_idx" ON "tab_event_log" USING btree ("tenant_id","event_kind");
CREATE INDEX IF NOT EXISTS "tab_event_log_capture_idx" ON "tab_event_log" USING btree ("capture_id");
CREATE TABLE IF NOT EXISTS "tab_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"module_template_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "tab_subscriptions_tenant_persona_idx" ON "tab_subscriptions" USING btree ("tenant_id","persona_id");
CREATE INDEX IF NOT EXISTS "tab_subscriptions_channel_idx" ON "tab_subscriptions" USING btree ("channel_name");
CREATE UNIQUE INDEX IF NOT EXISTS "tab_subscriptions_tenant_persona_module_uq" ON "tab_subscriptions" USING btree ("tenant_id","persona_id","module_template_id");
CREATE TABLE IF NOT EXISTS "task_sensor_routing" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"task" text NOT NULL,
	"chain" jsonb NOT NULL,
	"cognition_mode" text DEFAULT 'default' NOT NULL,
	"reasoning" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_task_sensor_routing_tenant_task" ON "task_sensor_routing" USING btree ("tenant_id","task");
CREATE INDEX IF NOT EXISTS "idx_task_sensor_routing_task" ON "task_sensor_routing" USING btree ("task");
CREATE TABLE IF NOT EXISTS "temporal_communities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"label" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"algorithm" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_temporal_communities_tenant_size" ON "temporal_communities" USING btree ("tenant_id","size");
CREATE TABLE IF NOT EXISTS "temporal_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_key" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"community_id" text,
	"confidence" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"evidence_ids" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'user:unknown' NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_temporal_entities_biz_key" ON "temporal_entities" USING btree ("tenant_id","entity_type","entity_key","valid_from");
CREATE INDEX IF NOT EXISTS "idx_temporal_entities_tenant_type" ON "temporal_entities" USING btree ("tenant_id","entity_type");
CREATE INDEX IF NOT EXISTS "idx_temporal_entities_community" ON "temporal_entities" USING btree ("tenant_id","community_id");
CREATE INDEX IF NOT EXISTS "idx_temporal_entities_valid_window" ON "temporal_entities" USING btree ("tenant_id","valid_from","valid_to");
CREATE TABLE IF NOT EXISTS "temporal_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"from_entity_id" text NOT NULL,
	"to_entity_id" text NOT NULL,
	"relationship" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"community_id" text
);
CREATE INDEX IF NOT EXISTS "idx_temporal_relationships_from" ON "temporal_relationships" USING btree ("tenant_id","from_entity_id");
CREATE INDEX IF NOT EXISTS "idx_temporal_relationships_to" ON "temporal_relationships" USING btree ("tenant_id","to_entity_id");
CREATE INDEX IF NOT EXISTS "idx_temporal_relationships_rel" ON "temporal_relationships" USING btree ("tenant_id","relationship");
CREATE INDEX IF NOT EXISTS "idx_temporal_relationships_community" ON "temporal_relationships" USING btree ("tenant_id","community_id");
CREATE TABLE IF NOT EXISTS "tenant_ai_budgets" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"monthly_cap_usd_micro" bigint DEFAULT 0 NOT NULL,
	"hard_stop" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "tenant_autonomy_caps" (
	"tenant_id" text PRIMARY KEY NOT NULL,
	"max_mutations_per_day" integer DEFAULT 50 NOT NULL,
	"max_cost_usd_cents_per_day" bigint DEFAULT 500000 NOT NULL,
	"per_tool_tier_caps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"per_sub_md_caps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"slowdown_at" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"hard_stop_at" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "tenant_autonomy_caps_mutations_chk" CHECK ("tenant_autonomy_caps"."max_mutations_per_day" >= 0),
	CONSTRAINT "tenant_autonomy_caps_cost_chk" CHECK ("tenant_autonomy_caps"."max_cost_usd_cents_per_day" >= 0),
	CONSTRAINT "tenant_autonomy_caps_slowdown_chk" CHECK ("tenant_autonomy_caps"."slowdown_at" > 0 AND "tenant_autonomy_caps"."slowdown_at" <= 1),
	CONSTRAINT "tenant_autonomy_caps_hard_stop_chk" CHECK ("tenant_autonomy_caps"."hard_stop_at" > 0 AND "tenant_autonomy_caps"."hard_stop_at" <= 1),
	CONSTRAINT "tenant_autonomy_caps_slowdown_leq_hardstop_chk" CHECK ("tenant_autonomy_caps"."slowdown_at" <= "tenant_autonomy_caps"."hard_stop_at")
);
CREATE TABLE IF NOT EXISTS "tenant_budget_envelopes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"budget_usd_micro" bigint DEFAULT 0 NOT NULL,
	"consumed_usd_micro" bigint DEFAULT 0 NOT NULL,
	"alert_threshold_pct" integer DEFAULT 80 NOT NULL,
	"hard_cap_enforced" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_budget_envelopes_tenant_period" ON "tenant_budget_envelopes" USING btree ("tenant_id","period_start");
CREATE INDEX IF NOT EXISTS "idx_tenant_budget_envelopes_tenant" ON "tenant_budget_envelopes" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "tenant_feature_flag_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"flag_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_feature_flag_overrides_tenant_id_flag_key_unique" UNIQUE("tenant_id","flag_key")
);
CREATE INDEX IF NOT EXISTS "idx_tenant_ff_tenant" ON "tenant_feature_flag_overrides" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_tenant_ff_flag" ON "tenant_feature_flag_overrides" USING btree ("flag_key");
CREATE TABLE IF NOT EXISTS "tenant_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_normalized" text NOT NULL,
	"phone_country_code" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "tenant_identity_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"merged_into_id" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_identities_phone_idx" ON "tenant_identities" USING btree ("phone_normalized");
CREATE INDEX IF NOT EXISTS "tenant_identities_status_idx" ON "tenant_identities" USING btree ("status");
CREATE INDEX IF NOT EXISTS "tenant_identities_email_idx" ON "tenant_identities" USING btree ("email");
CREATE TABLE IF NOT EXISTS "thread_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"kind" "thread_event_kind" NOT NULL,
	"actor_id" text NOT NULL,
	"visibility_scope" "visibility_scope" NOT NULL,
	"visibility_author_actor_id" text NOT NULL,
	"visibility_initiating_user_id" text,
	"visibility_team_id" text,
	"visibility_rationale" text,
	"parent_event_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "thread_events_tenant_idx" ON "thread_events" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "thread_events_thread_idx" ON "thread_events" USING btree ("thread_id");
CREATE INDEX IF NOT EXISTS "thread_events_kind_idx" ON "thread_events" USING btree ("tenant_id","kind");
CREATE INDEX IF NOT EXISTS "thread_events_actor_idx" ON "thread_events" USING btree ("actor_id");
CREATE INDEX IF NOT EXISTS "thread_events_created_idx" ON "thread_events" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "thread_events_parent_idx" ON "thread_events" USING btree ("parent_event_id");
CREATE TABLE IF NOT EXISTS "threads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"initiating_user_id" text NOT NULL,
	"primary_persona_id" text NOT NULL,
	"team_id" text,
	"employee_id" text,
	"title" text NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"event_count" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "threads_tenant_idx" ON "threads" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "threads_user_idx" ON "threads" USING btree ("initiating_user_id");
CREATE INDEX IF NOT EXISTS "threads_persona_idx" ON "threads" USING btree ("tenant_id","primary_persona_id");
CREATE INDEX IF NOT EXISTS "threads_team_idx" ON "threads" USING btree ("team_id");
CREATE INDEX IF NOT EXISTS "threads_employee_idx" ON "threads" USING btree ("employee_id");
CREATE INDEX IF NOT EXISTS "threads_status_idx" ON "threads" USING btree ("tenant_id","status");
CREATE TABLE IF NOT EXISTS "training_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"path_id" text NOT NULL,
	"assignee_user_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"progress_pct" double precision DEFAULT 0 NOT NULL,
	"last_delivered_step" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_training_assignments_assignee" ON "training_assignments" USING btree ("tenant_id","assignee_user_id","status");
CREATE INDEX IF NOT EXISTS "idx_training_assignments_status" ON "training_assignments" USING btree ("tenant_id","status","assigned_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_training_assignments_path_assignee" ON "training_assignments" USING btree ("tenant_id","path_id","assignee_user_id");
CREATE TABLE IF NOT EXISTS "training_delivery_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"assignment_id" text NOT NULL,
	"step_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_training_delivery_events_assignment" ON "training_delivery_events" USING btree ("assignment_id","occurred_at");
CREATE INDEX IF NOT EXISTS "idx_training_delivery_events_type" ON "training_delivery_events" USING btree ("tenant_id","event_type","occurred_at");
CREATE TABLE IF NOT EXISTS "training_path_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"path_id" text NOT NULL,
	"order_index" integer NOT NULL,
	"concept_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mastery_threshold" double precision DEFAULT 0.8 NOT NULL,
	"estimated_minutes" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_training_path_steps_path_order" ON "training_path_steps" USING btree ("path_id","order_index");
CREATE TABLE IF NOT EXISTS "training_paths" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"audience" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"concept_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"generated_by" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "idx_training_paths_tenant" ON "training_paths" USING btree ("tenant_id","created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_training_paths_topic_audience" ON "training_paths" USING btree ("tenant_id","topic","audience");
CREATE TABLE IF NOT EXISTS "tutoring_skill_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"concept_slug" text NOT NULL,
	"display_name_en" text NOT NULL,
	"display_name_sw" text,
	"description" text,
	"prerequisite_concepts" text[],
	"mastery_thresholds_jsonb" jsonb NOT NULL,
	"content_jsonb" jsonb NOT NULL,
	"data_binding_jsonb" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_tutoring_skill_pack_slug_nonempty" CHECK (length("tutoring_skill_pack"."concept_slug") > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tutoring_skill_pack_platform_slug" ON "tutoring_skill_pack" USING btree ("concept_slug") WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tutoring_skill_pack_tenant_slug" ON "tutoring_skill_pack" USING btree ("tenant_id","concept_slug") WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_tutoring_skill_pack_tenant" ON "tutoring_skill_pack" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "ui_redesign_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"stage" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"ttl_seconds" integer,
	"session_id" text,
	"message_id" text,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_action_tracker" (
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action_id" text NOT NULL,
	"action_count" bigint DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_action_tracker_tenant_id_user_id_action_id_pk" PRIMARY KEY("tenant_id","user_id","action_id"),
	CONSTRAINT "user_action_tracker_action_count_chk" CHECK ("user_action_tracker"."action_count" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_user_action_tracker_tenant_last_seen" ON "user_action_tracker" USING btree ("tenant_id","last_seen" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "user_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_user_role_idx" ON "user_roles" USING btree ("user_id","role_id");
CREATE INDEX IF NOT EXISTS "user_roles_tenant_idx" ON "user_roles" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "verification_badges" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"identity_profile_id" text,
	"badge_type" "badge_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"awarded_at" timestamp with time zone NOT NULL,
	"awarded_by" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revocation_reason" text,
	"evidence_documents" jsonb DEFAULT '[]'::jsonb,
	"verification_method" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "verification_badges_tenant_idx" ON "verification_badges" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "verification_badges_customer_idx" ON "verification_badges" USING btree ("customer_id");
CREATE INDEX IF NOT EXISTS "verification_badges_badge_type_idx" ON "verification_badges" USING btree ("badge_type");
CREATE INDEX IF NOT EXISTS "verification_badges_active_idx" ON "verification_badges" USING btree ("is_active");
CREATE TABLE IF NOT EXISTS "voice_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"session_id" text NOT NULL,
	"customer_id" text,
	"turn_index" integer NOT NULL,
	"detected_language" text,
	"input_audio_ref" text,
	"input_transcript" text,
	"stt_confidence" double precision,
	"response_text" text,
	"response_audio_ref" text,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"degraded_mode" boolean DEFAULT false NOT NULL,
	"model_version" text,
	"prompt_hash" text,
	"latency_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_turns_turn_index_chk" CHECK ("voice_turns"."turn_index" >= 0),
	CONSTRAINT "voice_turns_stt_confidence_chk" CHECK ("voice_turns"."stt_confidence" IS NULL OR ("voice_turns"."stt_confidence" BETWEEN 0 AND 1)),
	CONSTRAINT "voice_turns_latency_chk" CHECK ("voice_turns"."latency_ms" IS NULL OR "voice_turns"."latency_ms" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_voice_turns_session" ON "voice_turns" USING btree ("tenant_id","session_id","turn_index");
CREATE INDEX IF NOT EXISTS "idx_voice_turns_customer" ON "voice_turns" USING btree ("tenant_id","customer_id","created_at" DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS "webhook_dead_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"target_url" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"total_attempts" integer NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"replayed_at" timestamp with time zone,
	"replayed_by" text,
	"replay_delivery_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_webhook_dlq_tenant" ON "webhook_dead_letters" USING btree ("tenant_id");
CREATE TABLE IF NOT EXISTS "webhook_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"target_url" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt_number" integer NOT NULL,
	"status" text NOT NULL,
	"status_code" integer,
	"response_body" text,
	"error_message" text,
	"scheduled_for" timestamp with time zone NOT NULL,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_webhook_attempts_tenant" ON "webhook_delivery_attempts" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_webhook_attempts_delivery" ON "webhook_delivery_attempts" USING btree ("delivery_id");
CREATE TABLE IF NOT EXISTS "worm_audit_log" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"document_kind" text NOT NULL,
	"document_id" text NOT NULL,
	"rendered_at_iso" text NOT NULL,
	"rendered_sha256" text NOT NULL,
	"citations_sha256" text NOT NULL,
	"previous_entry_hash" text,
	"chain_hash" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_worm_audit_tenant_sequence" ON "worm_audit_log" USING btree ("tenant_id","sequence_number");
CREATE INDEX IF NOT EXISTS "idx_worm_audit_tenant_sequence" ON "worm_audit_log" USING btree ("tenant_id","sequence_number");
CREATE INDEX IF NOT EXISTS "idx_worm_audit_chain_hash" ON "worm_audit_log" USING btree ("chain_hash");

-- Foreign keys (guarded; after all CREATEs).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_run_checkpoints_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "agency_run_checkpoints" ADD CONSTRAINT "agency_run_checkpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_cost_entries_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ai_cost_entries" ADD CONSTRAINT "ai_cost_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_decision_feedback_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ai_decision_feedback" ADD CONSTRAINT "ai_decision_feedback_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_proactive_alerts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ai_proactive_alerts" ADD CONSTRAINT "ai_proactive_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_semantic_memories_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ai_semantic_memories" ADD CONSTRAINT "ai_semantic_memories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anchor_summaries_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "anchor_summaries" ADD CONSTRAINT "anchor_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_policies_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "approval_policies" ADD CONSTRAINT "approval_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_policy_actions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "approval_policy_actions" ADD CONSTRAINT "approval_policy_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autonomous_action_audit_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "autonomous_action_audit" ADD CONSTRAINT "autonomous_action_audit_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'autonomy_policies_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "autonomy_policies" ADD CONSTRAINT "autonomy_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bottlenecks_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "bottlenecks" ADD CONSTRAINT "bottlenecks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communication_consents_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_capture_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "conversation_capture" ADD CONSTRAINT "conversation_capture_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_receipts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_receipts_message_instance_id_message_instances_id_fk') THEN
    ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_message_instance_id_message_instances_id_fk" FOREIGN KEY ("message_instance_id") REFERENCES "public"."message_instances"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_chat_messages_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "doc_chat_messages" ADD CONSTRAINT "doc_chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_chat_messages_session_id_doc_chat_sessions_id_fk') THEN
    ALTER TABLE "doc_chat_messages" ADD CONSTRAINT "doc_chat_messages_session_id_doc_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."doc_chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'doc_chat_sessions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "doc_chat_sessions" ADD CONSTRAINT "doc_chat_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_embeddings_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_render_jobs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "document_render_jobs" ADD CONSTRAINT "document_render_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episodic_notes_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "episodic_notes" ADD CONSTRAINT "episodic_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escalation_chain_runs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "escalation_chain_runs" ADD CONSTRAINT "escalation_chain_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escalation_chain_runs_chain_id_escalation_chains_id_fk') THEN
    ALTER TABLE "escalation_chain_runs" ADD CONSTRAINT "escalation_chain_runs_chain_id_escalation_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."escalation_chains"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'escalation_chains_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "escalation_chains" ADD CONSTRAINT "escalation_chains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_dead_letter_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "event_dead_letter" ADD CONSTRAINT "event_dead_letter_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_outbox_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_subscriptions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exception_inbox_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "exception_inbox" ADD CONSTRAINT "exception_inbox_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'executive_briefings_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "executive_briefings" ADD CONSTRAINT "executive_briefings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gdpr_deletion_requests_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "gdpr_deletion_requests" ADD CONSTRAINT "gdpr_deletion_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_assignments_organization_id_organizations_id_fk') THEN
    ALTER TABLE "geo_assignments" ADD CONSTRAINT "geo_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_assignments_geo_node_id_geo_nodes_id_fk') THEN
    ALTER TABLE "geo_assignments" ADD CONSTRAINT "geo_assignments_geo_node_id_geo_nodes_id_fk" FOREIGN KEY ("geo_node_id") REFERENCES "public"."geo_nodes"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_assignments_user_id_users_id_fk') THEN
    ALTER TABLE "geo_assignments" ADD CONSTRAINT "geo_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_label_types_organization_id_organizations_id_fk') THEN
    ALTER TABLE "geo_label_types" ADD CONSTRAINT "geo_label_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_node_closure_ancestor_id_geo_nodes_id_fk') THEN
    ALTER TABLE "geo_node_closure" ADD CONSTRAINT "geo_node_closure_ancestor_id_geo_nodes_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."geo_nodes"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_node_closure_descendant_id_geo_nodes_id_fk') THEN
    ALTER TABLE "geo_node_closure" ADD CONSTRAINT "geo_node_closure_descendant_id_geo_nodes_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."geo_nodes"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_nodes_organization_id_organizations_id_fk') THEN
    ALTER TABLE "geo_nodes" ADD CONSTRAINT "geo_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'geo_nodes_label_type_id_geo_label_types_id_fk') THEN
    ALTER TABLE "geo_nodes" ADD CONSTRAINT "geo_nodes_label_type_id_geo_label_types_id_fk" FOREIGN KEY ("label_type_id") REFERENCES "public"."geo_label_types"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packets_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "handoff_packets" ADD CONSTRAINT "handoff_packets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packets_thread_id_threads_id_fk') THEN
    ALTER TABLE "handoff_packets" ADD CONSTRAINT "handoff_packets_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'handoff_packets_event_id_thread_events_id_fk') THEN
    ALTER TABLE "handoff_packets" ADD CONSTRAINT "handoff_packets_event_id_thread_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."thread_events"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_profiles_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "identity_profiles" ADD CONSTRAINT "identity_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'implicit_feedback_signals_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "implicit_feedback_signals" ADD CONSTRAINT "implicit_feedback_signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'improvement_snapshots_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "improvement_snapshots" ADD CONSTRAINT "improvement_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactive_report_action_acks_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "interactive_report_action_acks" ADD CONSTRAINT "interactive_report_action_acks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactive_report_action_acks_interactive_report_version_id_interactive_report_versions_id_fk') THEN
    ALTER TABLE "interactive_report_action_acks" ADD CONSTRAINT "interactive_report_action_acks_interactive_report_version_id_interactive_report_versions_id_fk" FOREIGN KEY ("interactive_report_version_id") REFERENCES "public"."interactive_report_versions"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'interactive_report_versions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "interactive_report_versions" ADD CONSTRAINT "interactive_report_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_codes_organization_id_organizations_id_fk') THEN
    ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_codes_platform_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_platform_tenant_id_tenants_id_fk" FOREIGN KEY ("platform_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invite_codes_issued_by_users_id_fk') THEN
    ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_cot_reservoir_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_cot_reservoir" ADD CONSTRAINT "kernel_cot_reservoir_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_memory_episodic_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_memory_episodic" ADD CONSTRAINT "kernel_memory_episodic_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_memory_procedural_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_memory_procedural" ADD CONSTRAINT "kernel_memory_procedural_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_memory_reflective_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_memory_reflective" ADD CONSTRAINT "kernel_memory_reflective_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_memory_semantic_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_memory_semantic" ADD CONSTRAINT "kernel_memory_semantic_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_persona_drift_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_persona_drift_events" ADD CONSTRAINT "kernel_persona_drift_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kernel_provenance_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "kernel_provenance" ADD CONSTRAINT "kernel_provenance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memory_blocks_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "memory_blocks" ADD CONSTRAINT "memory_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_instances_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "message_instances" ADD CONSTRAINT "message_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_instances_template_id_message_templates_id_fk') THEN
    ALTER TABLE "message_instances" ADD CONSTRAINT "message_instances_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_templates_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'migration_runs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_update_proposals_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "module_update_proposals" ADD CONSTRAINT "module_update_proposals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_update_proposals_capture_id_conversation_capture_id_fk') THEN
    ALTER TABLE "module_update_proposals" ADD CONSTRAINT "module_update_proposals_capture_id_conversation_capture_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."conversation_capture"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_close_run_steps_run_id_monthly_close_runs_id_fk') THEN
    ALTER TABLE "monthly_close_run_steps" ADD CONSTRAINT "monthly_close_run_steps_run_id_monthly_close_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monthly_close_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_close_run_steps_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "monthly_close_run_steps" ADD CONSTRAINT "monthly_close_run_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'monthly_close_runs_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "monthly_close_runs" ADD CONSTRAINT "monthly_close_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocr_extractions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ocr_extractions_document_upload_id_document_uploads_id_fk') THEN
    ALTER TABLE "ocr_extractions" ADD CONSTRAINT "ocr_extractions_document_upload_id_document_uploads_id_fk" FOREIGN KEY ("document_upload_id") REFERENCES "public"."document_uploads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_memberships_tenant_identity_id_tenant_identities_id_fk') THEN
    ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_tenant_identity_id_tenant_identities_id_fk" FOREIGN KEY ("tenant_identity_id") REFERENCES "public"."tenant_identities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_memberships_organization_id_organizations_id_fk') THEN
    ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_memberships_platform_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_platform_tenant_id_tenants_id_fk" FOREIGN KEY ("platform_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_memberships_user_id_users_id_fk') THEN
    ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_layouts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "portal_layouts" ADD CONSTRAINT "portal_layouts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_observations_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "process_observations" ADD CONSTRAINT "process_observations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progressive_context_snapshots_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "progressive_context_snapshots" ADD CONSTRAINT "progressive_context_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reflexion_buffer_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "reflexion_buffer" ADD CONSTRAINT "reflexion_buffer_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reflexion_guidelines_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "reflexion_guidelines" ADD CONSTRAINT "reflexion_guidelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_bundle_pages_bundle_id_scan_bundles_id_fk') THEN
    ALTER TABLE "scan_bundle_pages" ADD CONSTRAINT "scan_bundle_pages_bundle_id_scan_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."scan_bundles"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_bundle_pages_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "scan_bundle_pages" ADD CONSTRAINT "scan_bundle_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scan_bundles_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "scan_bundles" ADD CONSTRAINT "scan_bundles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'semantic_cache_log_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "semantic_cache_log" ADD CONSTRAINT "semantic_cache_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'skill_registry_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "skill_registry" ADD CONSTRAINT "skill_registry_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sovereign_approvals_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sovereign_approvals" ADD CONSTRAINT "sovereign_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sub_md_slo_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sub_md_slo_events" ADD CONSTRAINT "sub_md_slo_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sub_md_slos_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "sub_md_slos" ADD CONSTRAINT "sub_md_slos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tab_event_log_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tab_event_log" ADD CONSTRAINT "tab_event_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tab_subscriptions_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tab_subscriptions" ADD CONSTRAINT "tab_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'temporal_communities_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "temporal_communities" ADD CONSTRAINT "temporal_communities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'temporal_entities_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "temporal_entities" ADD CONSTRAINT "temporal_entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'temporal_relationships_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "temporal_relationships" ADD CONSTRAINT "temporal_relationships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'temporal_relationships_from_entity_id_temporal_entities_id_fk') THEN
    ALTER TABLE "temporal_relationships" ADD CONSTRAINT "temporal_relationships_from_entity_id_temporal_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."temporal_entities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'temporal_relationships_to_entity_id_temporal_entities_id_fk') THEN
    ALTER TABLE "temporal_relationships" ADD CONSTRAINT "temporal_relationships_to_entity_id_temporal_entities_id_fk" FOREIGN KEY ("to_entity_id") REFERENCES "public"."temporal_entities"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_ai_budgets_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tenant_ai_budgets" ADD CONSTRAINT "tenant_ai_budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_autonomy_caps_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tenant_autonomy_caps" ADD CONSTRAINT "tenant_autonomy_caps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_feature_flag_overrides_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "tenant_feature_flag_overrides" ADD CONSTRAINT "tenant_feature_flag_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_feature_flag_overrides_flag_key_feature_flags_flag_key_fk') THEN
    ALTER TABLE "tenant_feature_flag_overrides" ADD CONSTRAINT "tenant_feature_flag_overrides_flag_key_feature_flags_flag_key_fk" FOREIGN KEY ("flag_key") REFERENCES "public"."feature_flags"("flag_key") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thread_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "thread_events" ADD CONSTRAINT "thread_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thread_events_thread_id_threads_id_fk') THEN
    ALTER TABLE "thread_events" ADD CONSTRAINT "thread_events_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'threads_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "threads" ADD CONSTRAINT "threads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'threads_initiating_user_id_users_id_fk') THEN
    ALTER TABLE "threads" ADD CONSTRAINT "threads_initiating_user_id_users_id_fk" FOREIGN KEY ("initiating_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_assignments_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_assignments_path_id_training_paths_id_fk') THEN
    ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_path_id_training_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."training_paths"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_delivery_events_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "training_delivery_events" ADD CONSTRAINT "training_delivery_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_delivery_events_assignment_id_training_assignments_id_fk') THEN
    ALTER TABLE "training_delivery_events" ADD CONSTRAINT "training_delivery_events_assignment_id_training_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."training_assignments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_path_steps_path_id_training_paths_id_fk') THEN
    ALTER TABLE "training_path_steps" ADD CONSTRAINT "training_path_steps_path_id_training_paths_id_fk" FOREIGN KEY ("path_id") REFERENCES "public"."training_paths"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_paths_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "training_paths" ADD CONSTRAINT "training_paths_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_user_id_users_id_fk') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_id_roles_id_fk') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_badges_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_badges_identity_profile_id_identity_profiles_id_fk') THEN
    ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_identity_profile_id_identity_profiles_id_fk" FOREIGN KEY ("identity_profile_id") REFERENCES "public"."identity_profiles"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_turns_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "voice_turns" ADD CONSTRAINT "voice_turns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_dead_letters_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "webhook_dead_letters" ADD CONSTRAINT "webhook_dead_letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_delivery_attempts_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- RLS — per-scope tenant isolation (CLAUDE.md hard rule).
ALTER TABLE a2a_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE a2a_tasks FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='a2a_tasks' AND policyname='a2a_tasks_tenant_isolation') THEN
    CREATE POLICY a2a_tasks_tenant_isolation ON a2a_tasks FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.a2a_tasks FROM anon;'; END IF;
END $$;
ALTER TABLE action_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_plans FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='action_plans' AND policyname='action_plans_tenant_isolation') THEN
    CREATE POLICY action_plans_tenant_isolation ON action_plans FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.action_plans FROM anon;'; END IF;
END $$;
ALTER TABLE action_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_quotas FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='action_quotas' AND policyname='action_quotas_tenant_isolation') THEN
    CREATE POLICY action_quotas_tenant_isolation ON action_quotas FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.action_quotas FROM anon;'; END IF;
END $$;
ALTER TABLE action_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_steps FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='action_steps' AND policyname='action_steps_tenant_isolation') THEN
    CREATE POLICY action_steps_tenant_isolation ON action_steps FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.action_steps FROM anon;'; END IF;
END $$;
ALTER TABLE agency_run_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_run_checkpoints FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='agency_run_checkpoints' AND policyname='agency_run_checkpoints_tenant_isolation') THEN
    CREATE POLICY agency_run_checkpoints_tenant_isolation ON agency_run_checkpoints FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.agency_run_checkpoints FROM anon;'; END IF;
END $$;
ALTER TABLE ai_cost_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cost_entries FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_cost_entries' AND policyname='ai_cost_entries_tenant_isolation') THEN
    CREATE POLICY ai_cost_entries_tenant_isolation ON ai_cost_entries FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ai_cost_entries FROM anon;'; END IF;
END $$;
ALTER TABLE ai_decision_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_decision_feedback FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_decision_feedback' AND policyname='ai_decision_feedback_tenant_isolation') THEN
    CREATE POLICY ai_decision_feedback_tenant_isolation ON ai_decision_feedback FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ai_decision_feedback FROM anon;'; END IF;
END $$;
ALTER TABLE ai_proactive_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_proactive_alerts FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_proactive_alerts' AND policyname='ai_proactive_alerts_tenant_isolation') THEN
    CREATE POLICY ai_proactive_alerts_tenant_isolation ON ai_proactive_alerts FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ai_proactive_alerts FROM anon;'; END IF;
END $$;
ALTER TABLE ai_semantic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_semantic_memories FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_semantic_memories' AND policyname='ai_semantic_memories_tenant_isolation') THEN
    CREATE POLICY ai_semantic_memories_tenant_isolation ON ai_semantic_memories FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ai_semantic_memories FROM anon;'; END IF;
END $$;
ALTER TABLE anchor_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchor_summaries FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='anchor_summaries' AND policyname='anchor_summaries_tenant_isolation') THEN
    CREATE POLICY anchor_summaries_tenant_isolation ON anchor_summaries FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.anchor_summaries FROM anon;'; END IF;
END $$;
ALTER TABLE aop_active_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aop_active_versions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='aop_active_versions' AND policyname='aop_active_versions_tenant_isolation') THEN
    CREATE POLICY aop_active_versions_tenant_isolation ON aop_active_versions FOR ALL
      USING (scope_tenant_id IS NULL OR scope_tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (scope_tenant_id IS NULL OR scope_tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.aop_active_versions FROM anon;'; END IF;
END $$;
ALTER TABLE aop_regression_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE aop_regression_sets FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='aop_regression_sets' AND policyname='aop_regression_sets_tenant_isolation') THEN
    CREATE POLICY aop_regression_sets_tenant_isolation ON aop_regression_sets FOR ALL
      USING (scope_tenant_id IS NULL OR scope_tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (scope_tenant_id IS NULL OR scope_tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.aop_regression_sets FROM anon;'; END IF;
END $$;
ALTER TABLE aop_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aop_specs FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='aop_specs' AND policyname='aop_specs_tenant_isolation') THEN
    CREATE POLICY aop_specs_tenant_isolation ON aop_specs FOR ALL
      USING (scope_tenant_id IS NULL OR scope_tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (scope_tenant_id IS NULL OR scope_tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.aop_specs FROM anon;'; END IF;
END $$;
ALTER TABLE approval_matrix_dsl_compiled ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_matrix_dsl_compiled FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approval_matrix_dsl_compiled' AND policyname='approval_matrix_dsl_compiled_tenant_isolation') THEN
    CREATE POLICY approval_matrix_dsl_compiled_tenant_isolation ON approval_matrix_dsl_compiled FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.approval_matrix_dsl_compiled FROM anon;'; END IF;
END $$;
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policies FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approval_policies' AND policyname='approval_policies_tenant_isolation') THEN
    CREATE POLICY approval_policies_tenant_isolation ON approval_policies FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.approval_policies FROM anon;'; END IF;
END $$;
ALTER TABLE approval_policy_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policy_actions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='approval_policy_actions' AND policyname='approval_policy_actions_tenant_isolation') THEN
    CREATE POLICY approval_policy_actions_tenant_isolation ON approval_policy_actions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.approval_policy_actions FROM anon;'; END IF;
END $$;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_events' AND policyname='audit_events_tenant_isolation') THEN
    CREATE POLICY audit_events_tenant_isolation ON audit_events FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.audit_events FROM anon;'; END IF;
END $$;
ALTER TABLE autonomous_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomous_action_audit FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='autonomous_action_audit' AND policyname='autonomous_action_audit_tenant_isolation') THEN
    CREATE POLICY autonomous_action_audit_tenant_isolation ON autonomous_action_audit FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.autonomous_action_audit FROM anon;'; END IF;
END $$;
ALTER TABLE autonomy_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomy_policies FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='autonomy_policies' AND policyname='autonomy_policies_tenant_isolation') THEN
    CREATE POLICY autonomy_policies_tenant_isolation ON autonomy_policies FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.autonomy_policies FROM anon;'; END IF;
END $$;
ALTER TABLE bottlenecks ENABLE ROW LEVEL SECURITY;
ALTER TABLE bottlenecks FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bottlenecks' AND policyname='bottlenecks_tenant_isolation') THEN
    CREATE POLICY bottlenecks_tenant_isolation ON bottlenecks FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.bottlenecks FROM anon;'; END IF;
END $$;
ALTER TABLE carbon_market_book_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE carbon_market_book_entries FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='carbon_market_book_entries' AND policyname='carbon_market_book_entries_tenant_isolation') THEN
    CREATE POLICY carbon_market_book_entries_tenant_isolation ON carbon_market_book_entries FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.carbon_market_book_entries FROM anon;'; END IF;
END $$;
ALTER TABLE communication_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_consents FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='communication_consents' AND policyname='communication_consents_tenant_isolation') THEN
    CREATE POLICY communication_consents_tenant_isolation ON communication_consents FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.communication_consents FROM anon;'; END IF;
END $$;
ALTER TABLE consolidation_emissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidation_emissions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='consolidation_emissions' AND policyname='consolidation_emissions_tenant_isolation') THEN
    CREATE POLICY consolidation_emissions_tenant_isolation ON consolidation_emissions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.consolidation_emissions FROM anon;'; END IF;
END $$;
ALTER TABLE conversation_capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_capture FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='conversation_capture' AND policyname='conversation_capture_tenant_isolation') THEN
    CREATE POLICY conversation_capture_tenant_isolation ON conversation_capture FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.conversation_capture FROM anon;'; END IF;
END $$;
ALTER TABLE core_memory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_memory_blocks FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='core_memory_blocks' AND policyname='core_memory_blocks_tenant_isolation') THEN
    CREATE POLICY core_memory_blocks_tenant_isolation ON core_memory_blocks FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.core_memory_blocks FROM anon;'; END IF;
END $$;
ALTER TABLE currency_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_preferences FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='currency_preferences' AND policyname='currency_preferences_tenant_isolation') THEN
    CREATE POLICY currency_preferences_tenant_isolation ON currency_preferences FOR ALL
      USING (scope_kind <> 'tenant' OR scope_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (scope_kind <> 'tenant' OR scope_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.currency_preferences FROM anon;'; END IF;
END $$;
ALTER TABLE decision_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_traces FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='decision_traces' AND policyname='decision_traces_tenant_isolation') THEN
    CREATE POLICY decision_traces_tenant_isolation ON decision_traces FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.decision_traces FROM anon;'; END IF;
END $$;
ALTER TABLE delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_receipts FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='delivery_receipts' AND policyname='delivery_receipts_tenant_isolation') THEN
    CREATE POLICY delivery_receipts_tenant_isolation ON delivery_receipts FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.delivery_receipts FROM anon;'; END IF;
END $$;
ALTER TABLE doc_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_chat_messages FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='doc_chat_messages' AND policyname='doc_chat_messages_tenant_isolation') THEN
    CREATE POLICY doc_chat_messages_tenant_isolation ON doc_chat_messages FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.doc_chat_messages FROM anon;'; END IF;
END $$;
ALTER TABLE doc_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE doc_chat_sessions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='doc_chat_sessions' AND policyname='doc_chat_sessions_tenant_isolation') THEN
    CREATE POLICY doc_chat_sessions_tenant_isolation ON doc_chat_sessions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.doc_chat_sessions FROM anon;'; END IF;
END $$;
ALTER TABLE document_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_logs FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_access_logs' AND policyname='document_access_logs_tenant_isolation') THEN
    CREATE POLICY document_access_logs_tenant_isolation ON document_access_logs FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.document_access_logs FROM anon;'; END IF;
END $$;
ALTER TABLE document_corpus_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_corpus_links FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_corpus_links' AND policyname='document_corpus_links_tenant_isolation') THEN
    CREATE POLICY document_corpus_links_tenant_isolation ON document_corpus_links FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.document_corpus_links FROM anon;'; END IF;
END $$;
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_embeddings FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_embeddings' AND policyname='document_embeddings_tenant_isolation') THEN
    CREATE POLICY document_embeddings_tenant_isolation ON document_embeddings FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.document_embeddings FROM anon;'; END IF;
END $$;
ALTER TABLE document_intelligence_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_intelligence_sessions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_intelligence_sessions' AND policyname='document_intelligence_sessions_tenant_isolation') THEN
    CREATE POLICY document_intelligence_sessions_tenant_isolation ON document_intelligence_sessions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.document_intelligence_sessions FROM anon;'; END IF;
END $$;
ALTER TABLE document_render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_render_jobs FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='document_render_jobs' AND policyname='document_render_jobs_tenant_isolation') THEN
    CREATE POLICY document_render_jobs_tenant_isolation ON document_render_jobs FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.document_render_jobs FROM anon;'; END IF;
END $$;
ALTER TABLE episodic_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_notes FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='episodic_notes' AND policyname='episodic_notes_tenant_isolation') THEN
    CREATE POLICY episodic_notes_tenant_isolation ON episodic_notes FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.episodic_notes FROM anon;'; END IF;
END $$;
ALTER TABLE escalation_chain_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_chain_runs FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='escalation_chain_runs' AND policyname='escalation_chain_runs_tenant_isolation') THEN
    CREATE POLICY escalation_chain_runs_tenant_isolation ON escalation_chain_runs FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.escalation_chain_runs FROM anon;'; END IF;
END $$;
ALTER TABLE escalation_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_chains FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='escalation_chains' AND policyname='escalation_chains_tenant_isolation') THEN
    CREATE POLICY escalation_chains_tenant_isolation ON escalation_chains FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.escalation_chains FROM anon;'; END IF;
END $$;
ALTER TABLE event_dead_letter ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dead_letter FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_dead_letter' AND policyname='event_dead_letter_tenant_isolation') THEN
    CREATE POLICY event_dead_letter_tenant_isolation ON event_dead_letter FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.event_dead_letter FROM anon;'; END IF;
END $$;
ALTER TABLE event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_outbox FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_outbox' AND policyname='event_outbox_tenant_isolation') THEN
    CREATE POLICY event_outbox_tenant_isolation ON event_outbox FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.event_outbox FROM anon;'; END IF;
END $$;
ALTER TABLE event_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_subscriptions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_subscriptions' AND policyname='event_subscriptions_tenant_isolation') THEN
    CREATE POLICY event_subscriptions_tenant_isolation ON event_subscriptions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.event_subscriptions FROM anon;'; END IF;
END $$;
ALTER TABLE exception_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE exception_inbox FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='exception_inbox' AND policyname='exception_inbox_tenant_isolation') THEN
    CREATE POLICY exception_inbox_tenant_isolation ON exception_inbox FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.exception_inbox FROM anon;'; END IF;
END $$;
ALTER TABLE executive_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_briefings FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='executive_briefings' AND policyname='executive_briefings_tenant_isolation') THEN
    CREATE POLICY executive_briefings_tenant_isolation ON executive_briefings FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.executive_briefings FROM anon;'; END IF;
END $$;
ALTER TABLE field_encryption_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_encryption_audit FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='field_encryption_audit' AND policyname='field_encryption_audit_tenant_isolation') THEN
    CREATE POLICY field_encryption_audit_tenant_isolation ON field_encryption_audit FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.field_encryption_audit FROM anon;'; END IF;
END $$;
ALTER TABLE gdpr_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gdpr_deletion_requests FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='gdpr_deletion_requests' AND policyname='gdpr_deletion_requests_tenant_isolation') THEN
    CREATE POLICY gdpr_deletion_requests_tenant_isolation ON gdpr_deletion_requests FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.gdpr_deletion_requests FROM anon;'; END IF;
END $$;
ALTER TABLE handoff_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_packets FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='handoff_packets' AND policyname='handoff_packets_tenant_isolation') THEN
    CREATE POLICY handoff_packets_tenant_isolation ON handoff_packets FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.handoff_packets FROM anon;'; END IF;
END $$;
ALTER TABLE identity_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_profiles FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='identity_profiles' AND policyname='identity_profiles_tenant_isolation') THEN
    CREATE POLICY identity_profiles_tenant_isolation ON identity_profiles FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.identity_profiles FROM anon;'; END IF;
END $$;
ALTER TABLE implicit_feedback_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE implicit_feedback_signals FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='implicit_feedback_signals' AND policyname='implicit_feedback_signals_tenant_isolation') THEN
    CREATE POLICY implicit_feedback_signals_tenant_isolation ON implicit_feedback_signals FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.implicit_feedback_signals FROM anon;'; END IF;
END $$;
ALTER TABLE improvement_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_snapshots FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='improvement_snapshots' AND policyname='improvement_snapshots_tenant_isolation') THEN
    CREATE POLICY improvement_snapshots_tenant_isolation ON improvement_snapshots FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.improvement_snapshots FROM anon;'; END IF;
END $$;
ALTER TABLE interactive_report_action_acks ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactive_report_action_acks FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='interactive_report_action_acks' AND policyname='interactive_report_action_acks_tenant_isolation') THEN
    CREATE POLICY interactive_report_action_acks_tenant_isolation ON interactive_report_action_acks FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.interactive_report_action_acks FROM anon;'; END IF;
END $$;
ALTER TABLE interactive_report_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactive_report_versions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='interactive_report_versions' AND policyname='interactive_report_versions_tenant_isolation') THEN
    CREATE POLICY interactive_report_versions_tenant_isolation ON interactive_report_versions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.interactive_report_versions FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_action_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_action_audit FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_action_audit' AND policyname='kernel_action_audit_tenant_isolation') THEN
    CREATE POLICY kernel_action_audit_tenant_isolation ON kernel_action_audit FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_action_audit FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_cot_reservoir ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_cot_reservoir FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_cot_reservoir' AND policyname='kernel_cot_reservoir_tenant_isolation') THEN
    CREATE POLICY kernel_cot_reservoir_tenant_isolation ON kernel_cot_reservoir FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_cot_reservoir FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_feedback FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_feedback' AND policyname='kernel_feedback_tenant_isolation') THEN
    CREATE POLICY kernel_feedback_tenant_isolation ON kernel_feedback FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_feedback FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_goals FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_goals' AND policyname='kernel_goals_tenant_isolation') THEN
    CREATE POLICY kernel_goals_tenant_isolation ON kernel_goals FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_goals FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_memory_episodic ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_memory_episodic FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_memory_episodic' AND policyname='kernel_memory_episodic_tenant_isolation') THEN
    CREATE POLICY kernel_memory_episodic_tenant_isolation ON kernel_memory_episodic FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_memory_episodic FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_memory_procedural ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_memory_procedural FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_memory_procedural' AND policyname='kernel_memory_procedural_tenant_isolation') THEN
    CREATE POLICY kernel_memory_procedural_tenant_isolation ON kernel_memory_procedural FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_memory_procedural FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_memory_reflective ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_memory_reflective FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_memory_reflective' AND policyname='kernel_memory_reflective_tenant_isolation') THEN
    CREATE POLICY kernel_memory_reflective_tenant_isolation ON kernel_memory_reflective FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_memory_reflective FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_memory_semantic ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_memory_semantic FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_memory_semantic' AND policyname='kernel_memory_semantic_tenant_isolation') THEN
    CREATE POLICY kernel_memory_semantic_tenant_isolation ON kernel_memory_semantic FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_memory_semantic FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_persona_drift_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_persona_drift_events FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_persona_drift_events' AND policyname='kernel_persona_drift_events_tenant_isolation') THEN
    CREATE POLICY kernel_persona_drift_events_tenant_isolation ON kernel_persona_drift_events FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_persona_drift_events FROM anon;'; END IF;
END $$;
ALTER TABLE kernel_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE kernel_provenance FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='kernel_provenance' AND policyname='kernel_provenance_tenant_isolation') THEN
    CREATE POLICY kernel_provenance_tenant_isolation ON kernel_provenance FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.kernel_provenance FROM anon;'; END IF;
END $$;
ALTER TABLE mdr_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdr_plan_items FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='mdr_plan_items' AND policyname='mdr_plan_items_tenant_isolation') THEN
    CREATE POLICY mdr_plan_items_tenant_isolation ON mdr_plan_items FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.mdr_plan_items FROM anon;'; END IF;
END $$;
ALTER TABLE memory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_blocks FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='memory_blocks' AND policyname='memory_blocks_tenant_isolation') THEN
    CREATE POLICY memory_blocks_tenant_isolation ON memory_blocks FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.memory_blocks FROM anon;'; END IF;
END $$;
ALTER TABLE message_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_instances FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='message_instances' AND policyname='message_instances_tenant_isolation') THEN
    CREATE POLICY message_instances_tenant_isolation ON message_instances FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.message_instances FROM anon;'; END IF;
END $$;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='message_templates' AND policyname='message_templates_tenant_isolation') THEN
    CREATE POLICY message_templates_tenant_isolation ON message_templates FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.message_templates FROM anon;'; END IF;
END $$;
ALTER TABLE migration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_runs FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='migration_runs' AND policyname='migration_runs_tenant_isolation') THEN
    CREATE POLICY migration_runs_tenant_isolation ON migration_runs FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.migration_runs FROM anon;'; END IF;
END $$;
ALTER TABLE module_update_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_update_proposals FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='module_update_proposals' AND policyname='module_update_proposals_tenant_isolation') THEN
    CREATE POLICY module_update_proposals_tenant_isolation ON module_update_proposals FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.module_update_proposals FROM anon;'; END IF;
END $$;
ALTER TABLE monthly_close_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_close_run_steps FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='monthly_close_run_steps' AND policyname='monthly_close_run_steps_tenant_isolation') THEN
    CREATE POLICY monthly_close_run_steps_tenant_isolation ON monthly_close_run_steps FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.monthly_close_run_steps FROM anon;'; END IF;
END $$;
ALTER TABLE monthly_close_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_close_runs FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='monthly_close_runs' AND policyname='monthly_close_runs_tenant_isolation') THEN
    CREATE POLICY monthly_close_runs_tenant_isolation ON monthly_close_runs FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.monthly_close_runs FROM anon;'; END IF;
END $$;
ALTER TABLE ocr_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_extractions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ocr_extractions' AND policyname='ocr_extractions_tenant_isolation') THEN
    CREATE POLICY ocr_extractions_tenant_isolation ON ocr_extractions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ocr_extractions FROM anon;'; END IF;
END $$;
ALTER TABLE owner_dashboard_layout ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_dashboard_layout FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='owner_dashboard_layout' AND policyname='owner_dashboard_layout_tenant_isolation') THEN
    CREATE POLICY owner_dashboard_layout_tenant_isolation ON owner_dashboard_layout FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.owner_dashboard_layout FROM anon;'; END IF;
END $$;
ALTER TABLE persona_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_branding FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='persona_branding' AND policyname='persona_branding_tenant_isolation') THEN
    CREATE POLICY persona_branding_tenant_isolation ON persona_branding FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.persona_branding FROM anon;'; END IF;
END $$;
ALTER TABLE portal_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_layouts FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_layouts' AND policyname='portal_layouts_tenant_isolation') THEN
    CREATE POLICY portal_layouts_tenant_isolation ON portal_layouts FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.portal_layouts FROM anon;'; END IF;
END $$;
ALTER TABLE presentation_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_themes FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='presentation_themes' AND policyname='presentation_themes_tenant_isolation') THEN
    CREATE POLICY presentation_themes_tenant_isolation ON presentation_themes FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.presentation_themes FROM anon;'; END IF;
END $$;
ALTER TABLE privacy_budget_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_budget_ledger FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='privacy_budget_ledger' AND policyname='privacy_budget_ledger_tenant_isolation') THEN
    CREATE POLICY privacy_budget_ledger_tenant_isolation ON privacy_budget_ledger FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.privacy_budget_ledger FROM anon;'; END IF;
END $$;
ALTER TABLE privacy_budget_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_budget_spend FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='privacy_budget_spend' AND policyname='privacy_budget_spend_tenant_isolation') THEN
    CREATE POLICY privacy_budget_spend_tenant_isolation ON privacy_budget_spend FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.privacy_budget_spend FROM anon;'; END IF;
END $$;
ALTER TABLE process_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_observations FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='process_observations' AND policyname='process_observations_tenant_isolation') THEN
    CREATE POLICY process_observations_tenant_isolation ON process_observations FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.process_observations FROM anon;'; END IF;
END $$;
ALTER TABLE progressive_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE progressive_context_snapshots FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='progressive_context_snapshots' AND policyname='progressive_context_snapshots_tenant_isolation') THEN
    CREATE POLICY progressive_context_snapshots_tenant_isolation ON progressive_context_snapshots FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.progressive_context_snapshots FROM anon;'; END IF;
END $$;
ALTER TABLE reflexion_buffer ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflexion_buffer FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reflexion_buffer' AND policyname='reflexion_buffer_tenant_isolation') THEN
    CREATE POLICY reflexion_buffer_tenant_isolation ON reflexion_buffer FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.reflexion_buffer FROM anon;'; END IF;
END $$;
ALTER TABLE reflexion_guidelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflexion_guidelines FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reflexion_guidelines' AND policyname='reflexion_guidelines_tenant_isolation') THEN
    CREATE POLICY reflexion_guidelines_tenant_isolation ON reflexion_guidelines FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.reflexion_guidelines FROM anon;'; END IF;
END $$;
ALTER TABLE reflexion_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE reflexion_lessons FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reflexion_lessons' AND policyname='reflexion_lessons_tenant_isolation') THEN
    CREATE POLICY reflexion_lessons_tenant_isolation ON reflexion_lessons FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.reflexion_lessons FROM anon;'; END IF;
END $$;
ALTER TABLE report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_templates FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='report_templates' AND policyname='report_templates_tenant_isolation') THEN
    CREATE POLICY report_templates_tenant_isolation ON report_templates FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.report_templates FROM anon;'; END IF;
END $$;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='roles' AND policyname='roles_tenant_isolation') THEN
    CREATE POLICY roles_tenant_isolation ON roles FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.roles FROM anon;'; END IF;
END $$;
ALTER TABLE scan_bundle_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_bundle_pages FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scan_bundle_pages' AND policyname='scan_bundle_pages_tenant_isolation') THEN
    CREATE POLICY scan_bundle_pages_tenant_isolation ON scan_bundle_pages FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.scan_bundle_pages FROM anon;'; END IF;
END $$;
ALTER TABLE scan_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_bundles FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scan_bundles' AND policyname='scan_bundles_tenant_isolation') THEN
    CREATE POLICY scan_bundles_tenant_isolation ON scan_bundles FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.scan_bundles FROM anon;'; END IF;
END $$;
ALTER TABLE section_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE section_layouts FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='section_layouts' AND policyname='section_layouts_tenant_isolation') THEN
    CREATE POLICY section_layouts_tenant_isolation ON section_layouts FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.section_layouts FROM anon;'; END IF;
END $$;
ALTER TABLE semantic_cache_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_cache_log FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='semantic_cache_log' AND policyname='semantic_cache_log_tenant_isolation') THEN
    CREATE POLICY semantic_cache_log_tenant_isolation ON semantic_cache_log FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.semantic_cache_log FROM anon;'; END IF;
END $$;
ALTER TABLE sensor_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_call_log FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sensor_call_log' AND policyname='sensor_call_log_tenant_isolation') THEN
    CREATE POLICY sensor_call_log_tenant_isolation ON sensor_call_log FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sensor_call_log FROM anon;'; END IF;
END $$;
ALTER TABLE sensorium_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensorium_event_log FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sensorium_event_log' AND policyname='sensorium_event_log_tenant_isolation') THEN
    CREATE POLICY sensorium_event_log_tenant_isolation ON sensorium_event_log FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sensorium_event_log FROM anon;'; END IF;
END $$;
ALTER TABLE session_replay_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_replay_chunks FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='session_replay_chunks' AND policyname='session_replay_chunks_tenant_isolation') THEN
    CREATE POLICY session_replay_chunks_tenant_isolation ON session_replay_chunks FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.session_replay_chunks FROM anon;'; END IF;
END $$;
ALTER TABLE skill_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_registry FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='skill_registry' AND policyname='skill_registry_tenant_isolation') THEN
    CREATE POLICY skill_registry_tenant_isolation ON skill_registry FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.skill_registry FROM anon;'; END IF;
END $$;
ALTER TABLE sovereign_action_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_action_ledger FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sovereign_action_ledger' AND policyname='sovereign_action_ledger_tenant_isolation') THEN
    CREATE POLICY sovereign_action_ledger_tenant_isolation ON sovereign_action_ledger FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sovereign_action_ledger FROM anon;'; END IF;
END $$;
ALTER TABLE sovereign_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE sovereign_approvals FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sovereign_approvals' AND policyname='sovereign_approvals_tenant_isolation') THEN
    CREATE POLICY sovereign_approvals_tenant_isolation ON sovereign_approvals FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sovereign_approvals FROM anon;'; END IF;
END $$;
ALTER TABLE sub_md_slo_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_md_slo_events FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sub_md_slo_events' AND policyname='sub_md_slo_events_tenant_isolation') THEN
    CREATE POLICY sub_md_slo_events_tenant_isolation ON sub_md_slo_events FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sub_md_slo_events FROM anon;'; END IF;
END $$;
ALTER TABLE sub_md_slos ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_md_slos FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sub_md_slos' AND policyname='sub_md_slos_tenant_isolation') THEN
    CREATE POLICY sub_md_slos_tenant_isolation ON sub_md_slos FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.sub_md_slos FROM anon;'; END IF;
END $$;
ALTER TABLE tab_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tab_event_log FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tab_event_log' AND policyname='tab_event_log_tenant_isolation') THEN
    CREATE POLICY tab_event_log_tenant_isolation ON tab_event_log FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tab_event_log FROM anon;'; END IF;
END $$;
ALTER TABLE tab_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tab_subscriptions FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tab_subscriptions' AND policyname='tab_subscriptions_tenant_isolation') THEN
    CREATE POLICY tab_subscriptions_tenant_isolation ON tab_subscriptions FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tab_subscriptions FROM anon;'; END IF;
END $$;
ALTER TABLE task_sensor_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_sensor_routing FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='task_sensor_routing' AND policyname='task_sensor_routing_tenant_isolation') THEN
    CREATE POLICY task_sensor_routing_tenant_isolation ON task_sensor_routing FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.task_sensor_routing FROM anon;'; END IF;
END $$;
ALTER TABLE temporal_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporal_communities FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='temporal_communities' AND policyname='temporal_communities_tenant_isolation') THEN
    CREATE POLICY temporal_communities_tenant_isolation ON temporal_communities FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.temporal_communities FROM anon;'; END IF;
END $$;
ALTER TABLE temporal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporal_entities FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='temporal_entities' AND policyname='temporal_entities_tenant_isolation') THEN
    CREATE POLICY temporal_entities_tenant_isolation ON temporal_entities FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.temporal_entities FROM anon;'; END IF;
END $$;
ALTER TABLE temporal_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporal_relationships FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='temporal_relationships' AND policyname='temporal_relationships_tenant_isolation') THEN
    CREATE POLICY temporal_relationships_tenant_isolation ON temporal_relationships FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.temporal_relationships FROM anon;'; END IF;
END $$;
ALTER TABLE tenant_ai_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_budgets FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_ai_budgets' AND policyname='tenant_ai_budgets_tenant_isolation') THEN
    CREATE POLICY tenant_ai_budgets_tenant_isolation ON tenant_ai_budgets FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tenant_ai_budgets FROM anon;'; END IF;
END $$;
ALTER TABLE tenant_autonomy_caps ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_autonomy_caps FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_autonomy_caps' AND policyname='tenant_autonomy_caps_tenant_isolation') THEN
    CREATE POLICY tenant_autonomy_caps_tenant_isolation ON tenant_autonomy_caps FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tenant_autonomy_caps FROM anon;'; END IF;
END $$;
ALTER TABLE tenant_budget_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_budget_envelopes FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_budget_envelopes' AND policyname='tenant_budget_envelopes_tenant_isolation') THEN
    CREATE POLICY tenant_budget_envelopes_tenant_isolation ON tenant_budget_envelopes FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tenant_budget_envelopes FROM anon;'; END IF;
END $$;
ALTER TABLE tenant_feature_flag_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_flag_overrides FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenant_feature_flag_overrides' AND policyname='tenant_feature_flag_overrides_tenant_isolation') THEN
    CREATE POLICY tenant_feature_flag_overrides_tenant_isolation ON tenant_feature_flag_overrides FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tenant_feature_flag_overrides FROM anon;'; END IF;
END $$;
ALTER TABLE thread_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_events FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='thread_events' AND policyname='thread_events_tenant_isolation') THEN
    CREATE POLICY thread_events_tenant_isolation ON thread_events FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.thread_events FROM anon;'; END IF;
END $$;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='threads' AND policyname='threads_tenant_isolation') THEN
    CREATE POLICY threads_tenant_isolation ON threads FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.threads FROM anon;'; END IF;
END $$;
ALTER TABLE training_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_assignments FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='training_assignments' AND policyname='training_assignments_tenant_isolation') THEN
    CREATE POLICY training_assignments_tenant_isolation ON training_assignments FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.training_assignments FROM anon;'; END IF;
END $$;
ALTER TABLE training_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_delivery_events FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='training_delivery_events' AND policyname='training_delivery_events_tenant_isolation') THEN
    CREATE POLICY training_delivery_events_tenant_isolation ON training_delivery_events FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.training_delivery_events FROM anon;'; END IF;
END $$;
ALTER TABLE training_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_paths FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='training_paths' AND policyname='training_paths_tenant_isolation') THEN
    CREATE POLICY training_paths_tenant_isolation ON training_paths FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.training_paths FROM anon;'; END IF;
END $$;
ALTER TABLE tutoring_skill_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutoring_skill_pack FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tutoring_skill_pack' AND policyname='tutoring_skill_pack_tenant_isolation') THEN
    CREATE POLICY tutoring_skill_pack_tenant_isolation ON tutoring_skill_pack FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.tutoring_skill_pack FROM anon;'; END IF;
END $$;
ALTER TABLE ui_redesign_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE ui_redesign_audit FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ui_redesign_audit' AND policyname='ui_redesign_audit_tenant_isolation') THEN
    CREATE POLICY ui_redesign_audit_tenant_isolation ON ui_redesign_audit FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.ui_redesign_audit FROM anon;'; END IF;
END $$;
ALTER TABLE user_action_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_action_tracker FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_action_tracker' AND policyname='user_action_tracker_tenant_isolation') THEN
    CREATE POLICY user_action_tracker_tenant_isolation ON user_action_tracker FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.user_action_tracker FROM anon;'; END IF;
END $$;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='user_roles_tenant_isolation') THEN
    CREATE POLICY user_roles_tenant_isolation ON user_roles FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.user_roles FROM anon;'; END IF;
END $$;
ALTER TABLE verification_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_badges FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='verification_badges' AND policyname='verification_badges_tenant_isolation') THEN
    CREATE POLICY verification_badges_tenant_isolation ON verification_badges FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.verification_badges FROM anon;'; END IF;
END $$;
ALTER TABLE voice_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_turns FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='voice_turns' AND policyname='voice_turns_tenant_isolation') THEN
    CREATE POLICY voice_turns_tenant_isolation ON voice_turns FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.voice_turns FROM anon;'; END IF;
END $$;
ALTER TABLE webhook_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_dead_letters FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_dead_letters' AND policyname='webhook_dead_letters_tenant_isolation') THEN
    CREATE POLICY webhook_dead_letters_tenant_isolation ON webhook_dead_letters FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.webhook_dead_letters FROM anon;'; END IF;
END $$;
ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempts FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='webhook_delivery_attempts' AND policyname='webhook_delivery_attempts_tenant_isolation') THEN
    CREATE POLICY webhook_delivery_attempts_tenant_isolation ON webhook_delivery_attempts FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.webhook_delivery_attempts FROM anon;'; END IF;
END $$;
ALTER TABLE worm_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE worm_audit_log FORCE  ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='worm_audit_log' AND policyname='worm_audit_log_tenant_isolation') THEN
    CREATE POLICY worm_audit_log_tenant_isolation ON worm_audit_log FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE 'REVOKE ALL ON public.worm_audit_log FROM anon;'; END IF;
END $$;

COMMIT;
