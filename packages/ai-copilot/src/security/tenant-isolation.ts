/**
 * BORJIE AI tenant isolation — Wave-11 AI security hardening.
 *
 * Hard boundary per AI call. Validates that every tool result, memory
 * fragment, and record being assembled into the prompt belongs to the
 * CURRENT tenantId. Throws TenantBoundaryError on breach — never silently
 * returns cross-tenant data.
 *
 * In BORJIE, tenants are organisations; fields named `tenant_id` /
 * `tenantId` are authoritative. We recognise a handful of parallel fields
 * (`org_id`, `organizationId`) for forward-compat with any legacy rows.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantContext {
  readonly tenantId: string;
  readonly actorId?: string;
  readonly personaId?: string;
}

export interface IsolationViolation {
  readonly type:
    | 'cross_tenant_record'
    | 'missing_tenant_filter'
    | 'unscoped_query';
  readonly path: string;
  readonly foreignTenantId?: string;
  readonly severity: 'critical' | 'high' | 'medium';
  readonly detail: string;
}

export interface IsolationCheckResult {
  readonly safe: boolean;
  readonly violations: readonly IsolationViolation[];
}

export class TenantBoundaryError extends Error {
  readonly code = 'TENANT_BOUNDARY_VIOLATION' as const;
  readonly tenantId: string;
  readonly violations: readonly IsolationViolation[];

  constructor(params: {
    tenantId: string;
    violations: readonly IsolationViolation[];
  }) {
    const firstPath = params.violations[0]?.path ?? '<unknown>';
    super(
      `Tenant boundary violation for ${params.tenantId}: ${params.violations.length} breach(es), first at ${firstPath}`,
    );
    this.name = 'TenantBoundaryError';
    this.tenantId = params.tenantId;
    this.violations = Object.freeze([...params.violations]);
  }
}

// ---------------------------------------------------------------------------
// D9 / G4 — cross-tenant denial audit sink.
// ---------------------------------------------------------------------------

export interface CrossTenantDenialRecord {
  readonly callerTenantId: string;
  readonly foreignTenantId?: string;
  readonly actorId?: string;
  readonly personaId?: string;
  readonly sessionId?: string;
  readonly violationPath: string;
  readonly violationType: IsolationViolation['type'];
  readonly severity: IsolationViolation['severity'];
  readonly detail: string;
  readonly verdict: 'blocked' | 'detected';
  readonly surface?: string;
  readonly traceId?: string;
  readonly occurredAt: string;
}

export interface CrossTenantDenialSink {
  record(row: CrossTenantDenialRecord): Promise<void> | void;
}

let __sink: CrossTenantDenialSink | null = null;

export function setCrossTenantDenialSink(sink: CrossTenantDenialSink | null): void {
  __sink = sink;
}

export function getCrossTenantDenialSink(): CrossTenantDenialSink | null {
  return __sink;
}

function emitDenials(
  ctx: TenantContext,
  violations: readonly IsolationViolation[],
  verdict: 'blocked' | 'detected',
  surface?: string,
  traceId?: string,
): void {
  if (!__sink || violations.length === 0) return;
  const now = new Date().toISOString();
  for (const v of violations) {
    try {
      const row: CrossTenantDenialRecord = {
        callerTenantId: ctx.tenantId || '<empty>',
        foreignTenantId: v.foreignTenantId,
        actorId: ctx.actorId,
        personaId: ctx.personaId,
        violationPath: v.path,
        violationType: v.type,
        severity: v.severity,
        detail: v.detail,
        verdict,
        surface,
        traceId,
        occurredAt: now,
      };
      const out = __sink.record(row);
      if (out && typeof (out as Promise<void>).then === 'function') {
        (out as Promise<void>).catch(() => {
          /* intentionally suppressed */
        });
      }
    } catch {
      /* intentionally suppressed */
    }
  }
}

export function createInMemoryCrossTenantDenialSink(): CrossTenantDenialSink & {
  rows(): readonly CrossTenantDenialRecord[];
  clear(): void;
} {
  const buf: CrossTenantDenialRecord[] = [];
  return {
    record(row) {
      buf.push(row);
    },
    rows() {
      return Object.freeze([...buf]);
    },
    clear() {
      buf.length = 0;
    },
  };
}


// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const TENANT_FIELD_KEYS = [
  'tenant_id',
  'tenantId',
  'org_id',
  'organization_id',
  'orgId',
  'organizationId',
] as const;

function isForeignTenantValue(
  value: unknown,
  expected: string,
): string | null {
  if (value === null || value === undefined) return null;
  const asString = String(value).trim();
  if (!asString || asString === 'null' || asString === 'undefined') return null;
  return asString === expected ? null : asString;
}

function walk(
  data: unknown,
  expected: string,
  path: string,
  out: IsolationViolation[],
): void {
  if (data === null || data === undefined) return;

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      walk(data[i], expected, `${path}[${i}]`, out);
    }
    return;
  }

  if (typeof data !== 'object') return;

  const record = data as Record<string, unknown>;
  for (const key of TENANT_FIELD_KEYS) {
    if (key in record) {
      const foreign = isForeignTenantValue(record[key], expected);
      if (foreign !== null) {
        out.push({
          type: 'cross_tenant_record',
          path: `${path}.${key}`,
          foreignTenantId: foreign,
          severity: 'critical',
          detail: `Field "${key}" has tenant "${foreign}" but current tenant is "${expected}"`,
        });
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    walk(value, expected, `${path}.${key}`, out);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Optional audit metadata accepted by validate/assert. Passing `surface`
 * + `traceId` lets the cross_tenant_denials table join cleanly against
 * the SecurityEvent stream.
 */
export interface ValidateOptions {
  readonly surface?: string;
  readonly traceId?: string;
}

/**
 * Deep scan an object graph for cross-tenant records. Safe to pass tool
 * results, memory fragments, or user-facing payloads.
 *
 * D9/G4: emits one row per violation to the registered
 * CrossTenantDenialSink with verdict='detected'.
 */
export function validateTenantScope(
  value: unknown,
  ctx: TenantContext,
  opts?: ValidateOptions,
): IsolationCheckResult {
  if (!ctx.tenantId) {
    const violations: IsolationViolation[] = [
      {
        type: 'missing_tenant_filter',
        path: '<context>',
        severity: 'high',
        detail: 'TenantContext.tenantId is empty; refusing to evaluate',
      },
    ];
    emitDenials(ctx, violations, 'detected', opts?.surface, opts?.traceId);
    return { safe: false, violations };
  }
  const violations: IsolationViolation[] = [];
  walk(value, ctx.tenantId, 'root', violations);
  if (violations.length > 0) {
    emitDenials(ctx, violations, 'detected', opts?.surface, opts?.traceId);
  }
  return { safe: violations.length === 0, violations };
}

/**
 * Guard variant — throws TenantBoundaryError on breach. Use inside the AI
 * call path where silent redaction is not acceptable.
 *
 * D9/G4: emits one row per violation to the registered
 * CrossTenantDenialSink with verdict='blocked' BEFORE throwing.
 */
export function assertTenantScope(
  value: unknown,
  ctx: TenantContext,
  opts?: ValidateOptions,
): void {
  // Compute violations without emitting through validateTenantScope (which
  // would record verdict='detected'). We want verdict='blocked' here.
  const violations: IsolationViolation[] = [];
  if (!ctx.tenantId) {
    violations.push({
      type: 'missing_tenant_filter',
      path: '<context>',
      severity: 'high',
      detail: 'TenantContext.tenantId is empty; refusing to evaluate',
    });
  } else {
    walk(value, ctx.tenantId, 'root', violations);
  }
  if (violations.length > 0) {
    emitDenials(ctx, violations, 'blocked', opts?.surface, opts?.traceId);
    throw new TenantBoundaryError({
      tenantId: ctx.tenantId || '<empty>',
      violations,
    });
  }
}

/**
 * Best-effort scrubber: replaces cross-tenant subtrees with a sentinel so the
 * LLM still receives a structurally-valid payload. Use at the OUTER edge (for
 * example, before rendering to the user) where you prefer degraded over crash.
 */
export function scrubForeignTenantData(
  value: unknown,
  ctx: TenantContext,
): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    const mapped = value
      .map((item) => scrubForeignTenantData(item, ctx))
      .filter((item) => {
        if (
          typeof item === 'object' &&
          item !== null &&
          'redacted' in (item as Record<string, unknown>)
        ) {
          return false;
        }
        return true;
      });
    return mapped;
  }
  if (typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  for (const key of TENANT_FIELD_KEYS) {
    if (key in record) {
      const foreign = isForeignTenantValue(record[key], ctx.tenantId);
      if (foreign !== null) {
        return { redacted: true, reason: 'cross_tenant_isolation' };
      }
    }
  }
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    cleaned[k] = scrubForeignTenantData(v, ctx);
  }
  return cleaned;
}

/**
 * Helper for the query-planning layer: reject filter objects that do not
 * carry an explicit tenant clause.
 */
export function assertQueryHasTenantFilter(
  description: string,
  filters: Readonly<Record<string, unknown>>,
  ctx: TenantContext,
  opts?: ValidateOptions,
): void {
  if (!ctx.tenantId) {
    const violations: IsolationViolation[] = [
      {
        type: 'missing_tenant_filter',
        path: description,
        severity: 'critical',
        detail: 'tenantId missing from context',
      },
    ];
    emitDenials(ctx, violations, 'blocked', opts?.surface, opts?.traceId);
    throw new TenantBoundaryError({
      tenantId: '<empty>',
      violations,
    });
  }
  const hasFilter = TENANT_FIELD_KEYS.some((k) => k in filters);
  if (!hasFilter) {
    const violations: IsolationViolation[] = [
      {
        type: 'missing_tenant_filter',
        path: description,
        severity: 'high',
        detail: `Query "${description}" missing tenant filter`,
      },
    ];
    emitDenials(ctx, violations, 'blocked', opts?.surface, opts?.traceId);
    throw new TenantBoundaryError({
      tenantId: ctx.tenantId,
      violations,
    });
  }
}
