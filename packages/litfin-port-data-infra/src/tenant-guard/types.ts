/**
 * Tenant-guard — core types.
 *
 * `TenantId` is a branded string so a raw `string` can never
 * accidentally flow into a tenant predicate. Pass every untrusted
 * input through `asTenantId()` before using it.
 *
 * `TenantContext` is the bag of facts every request carries about
 * the caller's tenancy. It includes:
 *   - `tenantId`: the org the call is FOR.
 *   - `actorTenantId`: when a Borjie internal user (borjie-admin tier)
 *     acts on another org's behalf, this is the Borjie tenant; the
 *     org tenant is in `tenantId`. For regular requests these match.
 *   - `requestId`: correlation id, threaded into every log and
 *     downstream call.
 *   - `consentBypass`: an explicit, audited override that lets a
 *     sovereign-tier write cross the tenant boundary in a fully
 *     traced way. Defaults to undefined; do NOT set casually.
 *
 * Ported verbatim from @litfin/tenant-guard; layered alongside Borjie's
 * own @borjie/tenant-isolation-guard (which is bigger + richer).
 */

declare const tenantIdBrand: unique symbol;
export type TenantId = string & { readonly [tenantIdBrand]: "TenantId" };

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorTenantId?: TenantId;
  readonly requestId: string;
  readonly consentBypass?: {
    readonly reason: string;
    readonly approvalId: string;
  };
}

export type IsolationLayer =
  | "context"
  | "drizzle"
  | "redis"
  | "storage"
  | "audit"
  | "logging"
  | "middleware";

export type IsolationViolationKind =
  | "missing-context"
  | "cross-tenant-id"
  | "missing-tenant-predicate"
  | "missing-tenant-prefix"
  | "audit-chain-break"
  | "malformed-tenant-id"
  | "stale-jwt-claim";

export class IsolationViolation extends Error {
  readonly code = "TENANT_ISOLATION_VIOLATION";
  readonly layer: IsolationLayer;
  readonly kind: IsolationViolationKind;
  readonly observedTenantId?: string;
  readonly expectedTenantId?: string;

  constructor(args: {
    readonly layer: IsolationLayer;
    readonly kind: IsolationViolationKind;
    readonly observedTenantId?: string;
    readonly expectedTenantId?: string;
    readonly hint?: string;
  }) {
    super(
      `[tenant-guard:${args.layer}/${args.kind}] ${args.hint ?? "isolation violation"} (observed=${args.observedTenantId ?? "?"} expected=${args.expectedTenantId ?? "?"})`,
    );
    this.name = "IsolationViolation";
    this.layer = args.layer;
    this.kind = args.kind;
    this.observedTenantId = args.observedTenantId;
    this.expectedTenantId = args.expectedTenantId;
  }
}

const TENANT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

/**
 * Brand + validate a tenant id. Returns null on malformed input.
 * Callers should treat a null return as a hard-error path (401 / 403
 * / refuse to act), NEVER as "fall back to a default tenant".
 */
export function asTenantId(raw: unknown): TenantId | null {
  if (typeof raw !== "string") return null;
  if (!TENANT_ID_PATTERN.test(raw)) return null;
  return raw as TenantId;
}

/**
 * Assert that a tenant id matches the current context. Use at every
 * boundary where user-controlled data may carry a tenant claim
 * (form submissions, JSON bodies, query params).
 */
export function assertSameTenant(
  observed: string | TenantId | null | undefined,
  contextTenantId: TenantId,
  layer: IsolationLayer = "context",
): asserts observed is TenantId {
  if (!observed) {
    throw new IsolationViolation({
      layer,
      kind: "cross-tenant-id",
      observedTenantId: String(observed),
      expectedTenantId: contextTenantId,
      hint: "missing tenant id on observed value",
    });
  }
  if (observed !== contextTenantId) {
    throw new IsolationViolation({
      layer,
      kind: "cross-tenant-id",
      observedTenantId: String(observed),
      expectedTenantId: contextTenantId,
      hint: "observed tenant does not match request context",
    });
  }
}
