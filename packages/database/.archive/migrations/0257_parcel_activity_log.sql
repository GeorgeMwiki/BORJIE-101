-- =============================================================================
-- 0257: parcel_activity_log — append-only hash-chained history per parcel.
--
-- Every meaningful change to a parcel emits a row here. Hash-chained
-- (prev_hash + canonical-JSON of this row → hash) so tampering with old
-- rows breaks chain validation downstream. Append-only at the application
-- layer; RLS modify policy permits INSERT only via a WITH CHECK guard
-- (no UPDATE / DELETE from authenticated; service-role may correct in
-- rare cases — and that correction itself appends a new row).
--
-- Event kinds (extensible — applications may add new slugs but should
-- prefer reusing these for canonical filtering):
--   * created            — parcel record created
--   * subdivided         — children parcels created from this parent
--   * status_changed     — status transition (available → reserved, etc.)
--   * metadata_changed   — KV metadata add / update
--   * evidence_attached  — title deed / lease / photo linked
--   * listed             — marketplace listing created
--   * sold               — listing marked sold
--   * leased             — lease signed
--   * price_changed      — asking_price_minor_units updated
--   * photo_added        — image_url appended
--   * tag_changed        — label / colour palette tag changed
--   * color_changed      — color_hex changed
-- =============================================================================

CREATE TABLE IF NOT EXISTS parcel_activity_log (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id               TEXT NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,
  event_kind              TEXT NOT NULL,
  event_payload_jsonb     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id           TEXT REFERENCES users(id),
  /** SOFT pointer to personas.id (Piece D). FK wired up when Piece D lands. */
  actor_persona_id        TEXT,
  /** Previous row's hash in the per-parcel chain (NULL for first row). */
  prev_hash               TEXT,
  /** Canonical hash of this row's content. Application computes. */
  hash                    TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE parcel_activity_log IS
  'Piece N: append-only hash-chained activity history per parcel. Tampering with old rows breaks chain validation.';

COMMENT ON COLUMN parcel_activity_log.actor_persona_id IS
  'SOFT pointer to personas.id (Piece D). FK wired when Piece D lands.';

COMMENT ON COLUMN parcel_activity_log.prev_hash IS
  'Hash of previous row in the per-parcel chain. NULL only for the first row of a parcel.';

COMMENT ON COLUMN parcel_activity_log.hash IS
  'SHA-256 (hex) of canonical JSON of (parcel_id || event_kind || event_payload_jsonb || prev_hash || created_at).';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — tenant isolation pattern with append-only enforcement.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'parcel_activity_log'
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
        'DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- Tenant-scoped SELECT.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- INSERT-only for authenticated. NO update / delete policy — those
      -- defaults to denied since RLS is force-enabled.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_insert ON public.%I
        FOR INSERT
        TO authenticated
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
