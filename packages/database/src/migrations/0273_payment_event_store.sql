-- =============================================================================
-- 0273: payment_event_store — append-only events for rent + arrears paths.
--
-- LITFIN-parity item 4. Backs `@borjie/payments-event-store`. Scoped this
-- pass to CRITICAL money paths: rent collection + arrears. Full payments-
-- ledger event-sourcing comes later once this base proves out in live test.
--
-- Design:
--   * `stream_id`         — aggregate root, e.g. "lease:<leaseId>"
--   * `version`           — monotonic per stream, starts at 1
--   * `global_seq`        — bigserial, monotonic across all streams (replay
--                           order, projector cursors, audit)
--   * `event_type`        — discriminator, e.g. "rent.due.recorded"
--   * `payload`           — JSONB of the full event (the type discriminator
--                           is duplicated for index/filter)
--
-- Concurrency: UNIQUE (stream_id, version) is the optimistic-concurrency
-- enforcement. The application reads MAX(version) for the stream, then
-- attempts INSERT at MAX+1. If two workers race, exactly one INSERT
-- succeeds; the other hits a unique-violation which the adapter
-- translates to OptimisticConcurrencyError.
--
-- LISTEN/NOTIFY: a trigger is wired so that consumers wanting realtime
-- delivery (the Drizzle adapter's `subscribe()` in a later iteration)
-- can pg_notify('payment_event_store', ...). The current adapter does
-- not yet poll the channel — placeholder, no behaviour change today.
--
-- RLS: standard tenant-isolation pattern (tenant_id derived from the
-- stream — leases carry tenant_id; the stream itself is logical so we
-- carry it on the row).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_event_store (
  global_seq    BIGSERIAL    PRIMARY KEY,
  stream_id     TEXT         NOT NULL,
  version       INTEGER      NOT NULL CHECK (version >= 1),
  tenant_id     TEXT         NOT NULL,
  event_type    TEXT         NOT NULL,
  payload       JSONB        NOT NULL,
  recorded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_event_store_stream_version_uq
    UNIQUE (stream_id, version),
  CONSTRAINT payment_event_store_event_type_chk CHECK (
    event_type IN (
      'rent.due.recorded',
      'payment.initiated',
      'payment.confirmed',
      'payment.failed',
      'arrears.accrued',
      'arrears.forgiven',
      'rent.reconciled'
    )
  )
);

COMMENT ON TABLE payment_event_store IS
  'P95 LITFIN-parity item 4: append-only event store for rent + arrears paths.';

COMMENT ON COLUMN payment_event_store.global_seq IS
  'Monotonic across all streams. Used for replay cursors + projector checkpoints.';

COMMENT ON COLUMN payment_event_store.stream_id IS
  'Aggregate root id, typically "lease:<leaseId>".';

COMMENT ON COLUMN payment_event_store.version IS
  'Monotonic per stream. UNIQUE (stream_id, version) enforces optimistic concurrency.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Indexes for replay + projector queries.
-- ─────────────────────────────────────────────────────────────────────────

-- Stream-replay: "give me all events for lease X from version V".
CREATE INDEX IF NOT EXISTS payment_event_store_stream_version_idx
  ON payment_event_store (stream_id, version);

-- Type-filtered projector: "all arrears.accrued events globally".
CREATE INDEX IF NOT EXISTS payment_event_store_event_type_seq_idx
  ON payment_event_store (event_type, global_seq);

-- Tenant scan (back-office reports + RLS predicate).
CREATE INDEX IF NOT EXISTS payment_event_store_tenant_seq_idx
  ON payment_event_store (tenant_id, global_seq);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. LISTEN/NOTIFY trigger (placeholder — adapter is no-op today).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION payment_event_store_notify()
  RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'payment_event_store',
    json_build_object(
      'global_seq', NEW.global_seq,
      'stream_id', NEW.stream_id,
      'version', NEW.version,
      'event_type', NEW.event_type
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_event_store_notify_trg ON payment_event_store;
CREATE TRIGGER payment_event_store_notify_trg
  AFTER INSERT ON payment_event_store
  FOR EACH ROW
  EXECUTE FUNCTION payment_event_store_notify();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Append-only enforcement: no UPDATE / DELETE.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION payment_event_store_no_mutate()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payment_event_store is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_event_store_no_update_trg ON payment_event_store;
CREATE TRIGGER payment_event_store_no_update_trg
  BEFORE UPDATE OR DELETE ON payment_event_store
  FOR EACH ROW
  EXECUTE FUNCTION payment_event_store_no_mutate();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Gold-standard RLS pattern (matches 0182..0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY['payment_event_store'];
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

      -- Insert-only modify policy (UPDATE/DELETE blocked by trigger
      -- regardless, but we keep tenant_isolation in WITH CHECK).
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR INSERT
        TO authenticated
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
