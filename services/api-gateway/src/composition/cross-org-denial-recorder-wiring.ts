/**
 * PO-port wave-5 wiring #4 — cross-tenant denial recorder.
 *
 * Wires the `@borjie/cross-org-denial-recorder` package as a
 * fire-and-forget audit-side sink for every cross-tenant access denial
 * surfaced by the gateway's authz layer.
 *
 * Hook point: `ensureTenantIsolation` middleware's `TENANT_MISMATCH`
 * branch (auth.tenantId !== request.tenantId after platform-admin
 * bypass). Each denial is `recordDenial`-ed via the bundle's
 * single-process `RecorderState` (per-actor 1s rate-limit + LRU-trim at
 * 5000 buckets — caps memory under burst).
 *
 * Default sink: in-memory ring buffer (10k rows). Swap to a Drizzle-
 * backed sink in a follow-up once a `cross_org_denials` table lands.
 *
 * The brute-force scanner (`findBruteForcePatterns`) is exposed on the
 * bundle so an ops endpoint can query recent denials for OWASP-style
 * anomalous-access patterns without re-running the recorder.
 */

import {
  createInMemorySink,
  createRecorderState,
  recordDenial,
  type DenialInput,
  type DenialRow,
  type DenialSink,
  type InMemorySink,
  type RecorderState,
} from '@borjie/cross-org-denial-recorder';

export interface CrossOrgDenialRecorderBundle {
  /** The backing sink (always wired — defaults to in-memory). */
  readonly sink: DenialSink;
  /** Per-process recorder state (rate-limit buckets + drop counter). */
  readonly state: RecorderState;
  /**
   * Record a cross-tenant denial. Fire-and-forget: never throws, never
   * blocks the response path. Returns the recorder's verdict so callers
   * can log a per-request observability tag if they want.
   */
  readonly record: (
    input: DenialInput,
  ) => Promise<{ readonly admitted: boolean; readonly droppedRollup: number }>;
  /**
   * Read recent rows when the in-memory sink is in use. Returns `null`
   * for non-introspectable sinks (DB-backed adapters) so callers can
   * route through their own query API instead.
   */
  readonly recentRows: () => ReadonlyArray<DenialRow> | null;
}

function isInMemorySink(sink: DenialSink): sink is InMemorySink {
  return typeof (sink as Partial<InMemorySink>).rows === 'function';
}

export interface CreateCrossOrgDenialRecorderBundleOptions {
  /** Override the default in-memory sink (DB-backed adapter, etc.). */
  readonly sink?: DenialSink;
}

/**
 * Build the cross-tenant denial recorder bundle. Defaults to an
 * in-memory sink with a 10k-row ring buffer; pass `options.sink` to
 * plug a Drizzle / Supabase / SIEM adapter.
 */
export function createCrossOrgDenialRecorderBundle(
  options: CreateCrossOrgDenialRecorderBundleOptions = {},
): CrossOrgDenialRecorderBundle {
  const sink = options.sink ?? createInMemorySink();
  const state = createRecorderState();

  return {
    sink,
    state,
    async record(input: DenialInput) {
      try {
        return await recordDenial(sink, input, { state });
      } catch {
        // Defensive — `recordDenial` already swallows sink errors, but
        // any synchronous failure (e.g. invalid input shape) still
        // degrades silently because cross-tenant denial logging must
        // NEVER break the response path.
        return { admitted: false, droppedRollup: 0 };
      }
    },
    recentRows() {
      if (isInMemorySink(sink)) {
        return sink.rows();
      }
      return null;
    },
  };
}
