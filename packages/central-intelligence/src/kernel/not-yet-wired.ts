/**
 * not-yet-wired — canonical placeholder vocabulary for unwired connector
 * and dispatcher slots in the composition root.
 *
 * Background
 * ──────────
 * The brain kernel ships HQ tools (`platform.evict_tenant`,
 * `platform.payout_owner`, `platform.file_kra_mri`,
 * `platform.verify_nida`, `platform.verify_eardhi_title`, etc.) that depend
 * on optional ports. Each port has TWO legitimate composition outcomes:
 *
 *   1. WIRED — env vars set, a real connector / Temporal dispatcher is
 *      threaded through.
 *   2. NOT-YET-WIRED — env vars unset; the composition root threads a
 *      structurally-correct stub that returns a deterministic refusal so
 *      the HQ tool surfaces a clean "subsystem not yet available" error
 *      instead of crashing the registry boot.
 *
 * Both outcomes are intentional. The audit gate (`scripts/audit-not-yet-wired.mjs`)
 * exists to enumerate (2) so each unwired slot can be progressively retired
 * as connectors land. To make that scanner reliable, every "not-yet-wired"
 * reason string and the canonical error class live in THIS module — call
 * sites reference `NOT_YET_WIRED_REASON.<TOKEN>` or
 * `new NotYetWiredError(NOT_YET_WIRED_REASON.<TOKEN>)` rather than embedding
 * the bare string `'NOT_YET_WIRED'` in JSDoc, comments, or log strings.
 *
 * Why a TS-level enum (not raw strings)?
 * ──────────────────────────────────────
 * Two reasons:
 *   - Compiler enforcement — typos in reason tokens fail at build time
 *     instead of leaking into operator-visible audit reports.
 *   - Audit-script ergonomy — the scanner can allowlist this single file
 *     and the upstream call sites stay free of bare `NOT_YET_WIRED` text
 *     that the scanner would otherwise flag.
 */

/**
 * Canonical reason tokens for every unwired connector / dispatcher in the
 * composition root. Add new tokens here when introducing a new optional
 * port — the audit script will pick up the call site automatically.
 */
export const NOT_YET_WIRED_REASON = Object.freeze({
  // ─── HQ tool port slots (services/api-gateway/src/composition) ────
  /** Top-level explanation in `hq-tool-port-bindings.ts` JSDoc. */
  HQ_TOOL_PORT_BINDINGS: 'hq-tool-port-bindings',
  /** B1's Drizzle-adapter fallback path in `hq-tool-registry.ts`. */
  HQ_TOOL_REGISTRY_STUB_BUNDLE: 'hq-tool-registry-stub-bundle',
  /** Composition-root cross-reference inside `service-registry.ts`. */
  SERVICE_REGISTRY_DEFERRED_BIND: 'service-registry-deferred-bind',

  // ─── Connector ports ─────────────────────────────────────────────
  /** NIDA biometric identity gateway. */
  NIDA_PORT: 'nida-port',
  /** e-Ardhi title-deed gateway. */
  EARDHI_PORT: 'eardhi-port',

  // ─── Temporal-backed sovereign workflow dispatchers ──────────────
  /** Eviction workflow dispatcher. */
  EVICTION_DISPATCHER: 'eviction-dispatcher',
  /** Owner-payout workflow dispatcher. */
  OWNER_PAYOUT_DISPATCHER: 'owner-payout-dispatcher',
  /** KRA MRI filing workflow dispatcher. */
  KRA_MRI_DISPATCHER: 'kra-mri-dispatcher',

  // ─── B1-adapter slots that fall back when no DB / worker is bound
  /** Consolidation worker fallback (legacy degraded boot path). */
  CONSOLIDATION_RUNNER: 'consolidation-runner',
  /** Tenants service — list + create surface. */
  TENANTS_SERVICE: 'tenants-service',
  /** Users service — list + create surface. */
  USERS_SERVICE: 'users-service',
  /** Feature flags write service. */
  FLAGS_WRITE_SERVICE: 'flags-write-service',
  /** Killswitch write service. */
  KILLSWITCH_WRITE_SERVICE: 'killswitch-write-service',
  /** Invoice adjustment service. */
  INVOICES_SERVICE: 'invoices-service',
  /** Announcement service. */
  ANNOUNCEMENTS_SERVICE: 'announcements-service',
} as const);

export type NotYetWiredReason =
  (typeof NOT_YET_WIRED_REASON)[keyof typeof NOT_YET_WIRED_REASON];

/**
 * Canonical error class thrown from composition-root stub adapters when
 * the underlying subsystem is not yet wired. The kernel's per-tool refusal
 * layer translates instances of this error into a clean `executor-failed`
 * outcome with the adapter name preserved so operators see a precise
 * "subsystem not yet wired" message instead of a 500.
 *
 * Throw shape:
 *
 *   throw new NotYetWiredError(NOT_YET_WIRED_REASON.EVICTION_DISPATCHER);
 *   throw new NotYetWiredError('custom.subname');   // ad-hoc — also legal
 */
/**
 * Optional construction options for `NotYetWiredError`. Callers that
 * know more than the bare reason token (e.g. "this unwired port affects
 * two HQ tools") can enrich the error so the kernel's degraded-mode
 * marker downstream is precise.
 */
export interface NotYetWiredErrorOptions {
  /**
   * Concrete capabilities this unwired subsystem blocks. Defaults to
   * `[reason]` so the round-trip through the kernel never loses the
   * relationship between subsystem and capability.
   */
  readonly affectedCapabilities?: ReadonlyArray<string>;
}

/**
 * Structured payload emitted by `toRefusalPayload()` — the canonical
 * shape consumed by the kernel's refusal layer and the
 * `DegradedDecisionMarker` it propagates downstream.
 */
export interface NotYetWiredRefusalPayload {
  readonly degraded: true;
  readonly reason: string;
  readonly affectedCapabilities: ReadonlyArray<string>;
  readonly message: string;
}

export class NotYetWiredError extends Error {
  /** The reason token (one of `NOT_YET_WIRED_REASON.*` or an ad-hoc string). */
  public readonly reason: string;
  /** Always `true` — used by cross-realm structural detection. */
  public readonly degraded: true;
  /** Capabilities this unwired subsystem blocks; defaults to `[reason]`. */
  public readonly affectedCapabilities: ReadonlyArray<string>;

  constructor(
    reason: NotYetWiredReason | string,
    options?: NotYetWiredErrorOptions,
  ) {
    super(`hq-tool: ${reason} adapter not yet wired in api-gateway`);
    this.name = 'NotYetWiredError';
    this.reason = reason;
    this.degraded = true;
    this.affectedCapabilities =
      options?.affectedCapabilities && options.affectedCapabilities.length > 0
        ? Object.freeze([...options.affectedCapabilities])
        : Object.freeze([reason]);
  }

  /**
   * Emit the structured refusal payload the kernel consumes to build a
   * `DegradedDecisionMarker`. Keeps the call sites in
   * `kernel/tools/hq-tool-registry` free from manual shape juggling.
   */
  toRefusalPayload(): NotYetWiredRefusalPayload {
    return {
      degraded: true,
      reason: this.reason,
      affectedCapabilities: this.affectedCapabilities,
      message: this.message,
    };
  }
}

/**
 * Type guard with cross-realm fallback. The `instanceof` check fails
 * when two copies of `not-yet-wired.ts` exist (e.g. a vitest setup that
 * loads the package under both its source path and its `dist` build);
 * we fall back to a structural check on `name + degraded` so the kernel
 * always recognises the marker.
 */
export function isNotYetWired(value: unknown): value is NotYetWiredError {
  if (value instanceof NotYetWiredError) return true;
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  const v = value as { name?: unknown; degraded?: unknown };
  return v.name === 'NotYetWiredError' && v.degraded === true;
}
