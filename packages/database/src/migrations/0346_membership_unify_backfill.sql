-- =============================================================================
-- Migration 0346 — person_links → org_memberships UNIFY backfill
-- (surface-completion SC-5: the owner's "cover all, NO LATER" override) +
-- the PENDING approval-queue index that 0345 could not build in the same
-- transaction as the enum extension.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Two parallel multi-org models existed: org_memberships (the SOTA
-- User⟷Membership⟷Org substrate, dark until SC-1) and person_links (live,
-- owner-web-only, backing /api/v1/me/tenants). The owner ruled the unify
-- happens IN THIS BUILD: org_memberships becomes the single system of record
-- for "which orgs does this human belong to"; /me/tenants re-reads over it;
-- person_links is demoted to a personal-KB-layer artifact (persons remains
-- the canonical human-profile table — that layer is NOT deprecated).
--
-- The backfill is LOSSLESS by construction — every live person_links row
-- maps, because:
--   * persons.primary_phone_e164 is NOT NULL UNIQUE → every linked human
--     gets (or matches) a tenant_identities row keyed on the digits-only
--     normalization of that phone.
--   * identity_auth_principals (0345) absorbs each link's supabase_user_id,
--     so any auth principal resolves to the unified graph.
--   * workforce-class links missing a `users` row in their tenant get a
--     DETERMINISTIC shadow user ('usr_pl_' || person_links.id) — the CHECK
--     from 0345 requires employment-class memberships to carry one.
--   * tenants that have live links but ZERO organizations rows get a
--     deterministic root org ('org_pl_' || tenant_id) — org_memberships
--     keys on organizations, and a hat must not strand for want of an org.
--   * role_in_tenant='buyer' maps to relationship_type='buyer_connection'
--     with user_id NULL (the corrected buyer model); everything else maps
--     to 'employment' with the original role preserved as the member_role
--     targeting label.
--
-- IDEMPOTENCY: every INSERT uses a DETERMINISTIC id derived from the source
-- row ('iap_pl_'/'usr_pl_'/'org_pl_'/'mem_pl_' prefixes) + ON CONFLICT DO
-- NOTHING, so a re-run is a pure no-op — no duplicate shadow rows.
--
-- TENANT SCOPE: all writes run under the service-role GUC (the touched
-- tables are FORCE-RLS'd); the GUC is session-local to the migration runner.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/migrations/0345_corrected_buyer_model_pairing_states.sql
--   * packages/database/src/migrations/down/0346_down_membership_unify_backfill.sql
--   * services/api-gateway/src/routes/me-tenants.hono.ts (re-read over org_memberships)
-- =============================================================================

BEGIN;

SELECT set_config('app.is_service_role', 'true', false);

-- ─── §1 — approval-queue hot path (uses the 0345 enum value — safe here, a
--          NEW transaction) ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS org_memberships_org_pending_idx
  ON org_memberships (organization_id, joined_at)
  WHERE status = 'PENDING';

-- ─── §2 — identities: one per linked human, keyed on normalized phone ───────
INSERT INTO tenant_identities
  (id, phone_normalized, phone_country_code, email, profile, status, created_at)
SELECT DISTINCT ON (regexp_replace(p.primary_phone_e164, '[^0-9]', '', 'g'))
  'tid_pl_' || p.id,
  regexp_replace(p.primary_phone_e164, '[^0-9]', '', 'g'),
  CASE
    WHEN p.primary_phone_e164 LIKE '+255%' THEN 'TZ'
    WHEN p.primary_phone_e164 LIKE '+254%' THEN 'KE'
    WHEN p.primary_phone_e164 LIKE '+256%' THEN 'UG'
    WHEN p.primary_phone_e164 LIKE '+234%' THEN 'NG'
    ELSE 'ZZ'  -- ISO 3166 user-assigned "unknown" — normalization origin unrecorded
  END,
  p.primary_email,
  jsonb_build_object(
    'displayName', p.display_name,
    'locale', p.preferred_language
  ),
  'ACTIVE',
  p.created_at
FROM persons p
WHERE EXISTS (
        SELECT 1 FROM person_links pl
         WHERE pl.person_id = p.id AND pl.unlinked_at IS NULL
      )
  AND length(regexp_replace(p.primary_phone_e164, '[^0-9]', '', 'g')) > 0
ON CONFLICT (phone_normalized) DO NOTHING;

-- ─── §3 — auth principals: each link's supabase sub → its identity ──────────
INSERT INTO identity_auth_principals
  (id, tenant_identity_id, supabase_user_id, auth_method, created_at)
SELECT DISTINCT ON (pl.supabase_user_id)
  'iap_pl_' || pl.id,
  ti.id,
  pl.supabase_user_id,
  'person-links-backfill',
  pl.linked_at
FROM person_links pl
JOIN persons p  ON p.id = pl.person_id
JOIN tenant_identities ti
  ON ti.phone_normalized = regexp_replace(p.primary_phone_e164, '[^0-9]', '', 'g')
WHERE pl.unlinked_at IS NULL
ORDER BY pl.supabase_user_id, pl.linked_at ASC
ON CONFLICT (supabase_user_id) DO NOTHING;

-- ─── §4 — root org for any linked tenant that has none ──────────────────────
-- SHAPE-ADAPTIVE: the migration-built organizations table is lean (id,
-- tenant_id, code, name, status, ...) while the Drizzle shape adds
-- level/path/is_active/deleted_at (the known schema-drift). Optional columns
-- are included only where they exist so this runs identically on both.
DO $$
DECLARE
  has_level   boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organizations' AND column_name='level');
  has_path    boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organizations' AND column_name='path');
  has_active  boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organizations' AND column_name='is_active');
  has_deleted boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organizations' AND column_name='deleted_at');
  extra_cols  text := '';
  extra_vals  text := '';
  not_deleted text := '';
BEGIN
  IF has_level   THEN extra_cols := extra_cols || ', level';     extra_vals := extra_vals || ', 0';      END IF;
  IF has_path    THEN extra_cols := extra_cols || ', path';      extra_vals := extra_vals || ', ''/'''; END IF;
  IF has_active  THEN extra_cols := extra_cols || ', is_active'; extra_vals := extra_vals || ', true';   END IF;
  IF has_deleted THEN not_deleted := ' AND o.deleted_at IS NULL'; END IF;

  EXECUTE format($ins$
    INSERT INTO organizations (id, tenant_id, code, name, created_at, updated_at%s)
    SELECT 'org_pl_' || t.id, t.id, 'ROOT',
           COALESCE(t.name, 'Organization'), now(), now()%s
    FROM tenants t
    WHERE EXISTS (
            SELECT 1 FROM person_links pl
             WHERE pl.tenant_id::text = t.id::text AND pl.unlinked_at IS NULL
          )
      AND NOT EXISTS (
            SELECT 1 FROM organizations o
             WHERE o.tenant_id::text = t.id::text%s
          )
    ON CONFLICT (id) DO NOTHING
  $ins$, extra_cols, extra_vals, not_deleted);
END $$;

-- ─── §5 — shadow users for workforce-class links that lack one ──────────────
-- Deterministic id 'usr_pl_' || pl.id keeps re-runs no-ops. Synthesized
-- emails are namespaced + unique per sub, satisfying (tenant_id, email)
-- uniqueness without colliding with a real address.
INSERT INTO users
  (id, tenant_id, email, first_name, last_name, display_name,
   status, mining_role, workforce_status, preferred_lang,
   created_at, updated_at, activated_at)
SELECT
  'usr_pl_' || pl.id,
  pl.tenant_id::text,
  COALESCE(
    p.primary_email,
    'shadow+' || pl.supabase_user_id::text || '@identity.borjie.app'
  ),
  COALESCE(NULLIF(split_part(p.display_name, ' ', 1), ''), 'Member'),
  COALESCE(
    NULLIF(btrim(substr(
      p.display_name,
      length(split_part(p.display_name, ' ', 1)) + 1
    )), ''),
    '-'
  ),
  p.display_name,
  'active',
  CASE pl.role_in_tenant
    WHEN 'owner'   THEN 'owner'
    WHEN 'admin'   THEN 'admin'
    WHEN 'manager' THEN 'site_manager'
    ELSE 'supervisor'
  END::borjie_user_role,
  'active',
  p.preferred_language,
  pl.linked_at,
  now(),
  pl.linked_at
FROM person_links pl
JOIN persons p ON p.id = pl.person_id
WHERE pl.unlinked_at IS NULL
  AND pl.role_in_tenant <> 'buyer'
  AND NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.tenant_id::text = pl.tenant_id::text
           AND u.id = pl.supabase_user_id::text
      )
ON CONFLICT (id) DO NOTHING;

-- ─── §6 — the memberships themselves ────────────────────────────────────────
-- SHAPE-ADAPTIVE on organizations like §4: the root-org pick orders by level
-- (hierarchy) only where the column exists, and filters deleted_at only
-- where present; created_at is the universal tiebreak.
DO $$
DECLARE
  has_level   boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organizations' AND column_name='level');
  has_deleted boolean := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='organizations' AND column_name='deleted_at');
  not_deleted text := '';
  order_by    text := 'o.created_at ASC';
BEGIN
  IF has_deleted THEN not_deleted := ' AND o.deleted_at IS NULL'; END IF;
  IF has_level   THEN order_by := 'o.level ASC, o.created_at ASC'; END IF;

  EXECUTE format($ins$
    INSERT INTO org_memberships
      (id, tenant_identity_id, organization_id, platform_tenant_id, user_id,
       status, relationship_type, member_role, joined_at)
    SELECT
      'mem_pl_' || pl.id,
      ti.id,
      root_org.id,
      pl.tenant_id::text,
      CASE WHEN pl.role_in_tenant = 'buyer' THEN NULL ELSE u.id END,
      'ACTIVE',
      CASE WHEN pl.role_in_tenant = 'buyer'
           THEN 'buyer_connection'
           ELSE 'employment'
      END::org_membership_relationship_type,
      pl.role_in_tenant,
      pl.linked_at
    FROM person_links pl
    JOIN persons p  ON p.id = pl.person_id
    JOIN tenant_identities ti
      ON ti.phone_normalized = regexp_replace(p.primary_phone_e164, '[^0-9]', '', 'g')
    LEFT JOIN LATERAL (
      SELECT o.id
        FROM organizations o
       WHERE o.tenant_id::text = pl.tenant_id::text%s
       ORDER BY %s
       LIMIT 1
    ) root_org ON true
    LEFT JOIN users u
      ON u.tenant_id::text = pl.tenant_id::text
     AND (u.id = pl.supabase_user_id::text OR u.id = 'usr_pl_' || pl.id::text)
    WHERE pl.unlinked_at IS NULL
      AND root_org.id IS NOT NULL
      AND (pl.role_in_tenant = 'buyer' OR u.id IS NOT NULL)
    ON CONFLICT (tenant_identity_id, organization_id) DO NOTHING
  $ins$, not_deleted, order_by);
END $$;

-- ─── §7 — demote person_links as a membership source ───────────────────────
COMMENT ON TABLE person_links IS
  'DEPRECATED as a MEMBERSHIP source (0346): org_memberships is the single '
  'system of record for which orgs a human belongs to; /me/tenants reads it. '
  'person_links remains a personal-KB-layer artifact only (persons stays '
  'canonical for human profile). Do not add new membership readers here.';

COMMIT;
