-- 0156_reminders_owner_tabs_rls_current_tenant.sql
--
-- Repoint the `reminders` and `owner_tabs` RLS policies from the legacy
-- `app.tenant_id` GUC to the canonical `app.current_tenant_id` that
-- api-gateway's `databaseMiddleware` (and the brain-teach auto-execute
-- transaction) actually bind.
--
-- WHY: 0089 created both policies on `current_setting('app.tenant_id', true)`.
-- 0150 fixed the GUC name for other tenant tables (request_for_bids,
-- request_for_bid_responses, owner_delegation_prefs, mwikila_actions_inbox)
-- but SKIPPED reminders + owner_tabs. Under FORCE RLS, a policy that reads a
-- GUC nobody sets evaluates to NULL = false -> every reminder / owner_tab
-- read AND write returns/affects zero rows. This silently broke both the
-- `/api/v1/owner/reminders` route and the new chat-driven action bridge
-- (`set_reminder` / `snooze_reminder`), whose inserts failed the WITH CHECK
-- and were swallowed by the executor's best-effort try/catch.
--
-- tenant_id is TEXT on both tables (0089), so the predicate compares directly
-- to current_setting (TEXT) — no cast. Idempotent (DROP POLICY IF EXISTS) so
-- it is safe to apply even if a deployed environment already carries the fix.

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminders_tenant_isolation ON reminders;
CREATE POLICY reminders_tenant_isolation ON reminders
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

ALTER TABLE owner_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_tabs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_tabs_tenant_isolation ON owner_tabs;
CREATE POLICY owner_tabs_tenant_isolation ON owner_tabs
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
