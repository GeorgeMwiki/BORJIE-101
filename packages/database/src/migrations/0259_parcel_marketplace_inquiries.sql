-- =============================================================================
-- 0259: parcel_marketplace_inquiries — buyer-side activity on listings.
--
-- When a user (often from a DIFFERENT tenant) clicks "I'm interested" on
-- a listing in the cross-tenant marketplace view, this table records the
-- inquiry. `tenant_id` is the tenant of the LISTING — so the listing
-- owner's RLS context can read all inquiries on their listings.
-- `inquirer_tenant_id` is the tenant of the inquirer (may differ).
--
-- The cross-tenant nature is preserved at the application layer:
--   * Inquirer's session: writes a row with their inquirer_user_id /
--     inquirer_tenant_id, the listing's tenant_id (looked up via the
--     public view), service-role bypass for the INSERT.
--   * Listing owner's session: reads their own tenant's inquiries via
--     tenant_isolation_select.
--
-- Statuses:
--   * open               — listing owner hasn't responded yet
--   * replied            — owner has reached out
--   * closed_no_interest — buyer or owner closed
--   * closed_deal        — deal closed (next step: ledger txn)
-- =============================================================================

CREATE TABLE IF NOT EXISTS parcel_marketplace_inquiries (
  id                      TEXT PRIMARY KEY,
  /** Tenant of the LISTING (not the inquirer). RLS isolates owner's view. */
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listing_id              TEXT NOT NULL REFERENCES parcel_marketplace_listings(id) ON DELETE CASCADE,
  inquirer_user_id        TEXT NOT NULL REFERENCES users(id),
  /** If inquirer is on a different tenant, the inquirer's tenant_id. NULL = same-tenant. */
  inquirer_tenant_id      TEXT,
  message                 TEXT,
  status                  TEXT NOT NULL DEFAULT 'open',
  contact_phone           TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replied_at              TIMESTAMPTZ,
  CONSTRAINT parcel_inquiry_status_chk CHECK (
    status IN ('open', 'replied', 'closed_no_interest', 'closed_deal')
  )
);

COMMENT ON TABLE parcel_marketplace_inquiries IS
  'Piece N: cross-tenant buyer inquiries on parcel listings. tenant_id = listing owner; inquirer_tenant_id may differ.';

COMMENT ON COLUMN parcel_marketplace_inquiries.tenant_id IS
  'Tenant of the LISTING. RLS isolates so listing owner sees only their own inquiries.';

COMMENT ON COLUMN parcel_marketplace_inquiries.inquirer_tenant_id IS
  'Tenant of the inquirer — may differ from tenant_id for cross-tenant inquiries.';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcel_marketplace_inquiries'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
