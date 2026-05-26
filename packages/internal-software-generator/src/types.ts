/**
 * `@borjie/internal-software-generator` — public type surface.
 *
 * Wave M8-M9. Mirrors the 2-table schema introduced by migration
 * `0039_internal_software.sql`:
 *
 *   - InternalTool    — a row in `internal_tools` (sealed bundle:
 *                       form schema + handler signature + dashboard
 *                       archetype + audit hook, plus lifecycle state
 *                       and authority tier).
 *   - InternalToolRun — a row in `internal_tool_runs` (per-execution
 *                       ledger: inputs, outputs, actor, audit hash).
 *
 * Plus the value enumerations the storage layer enforces.
 *
 * Spec: Docs/DESIGN/ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md.
 */

// ---------------------------------------------------------------------------
// Value enumerations — match the SQL CHECK constraints in 0039_*.sql
// ---------------------------------------------------------------------------

/** Five recognised tool kinds. The generator emits exactly one of these. */
export type ToolKind =
  | 'report'
  | 'workflow'
  | 'dashboard'
  | 'extractor'
  | 'watcher';

/**
 * Lifecycle state of an internal_tools row. Transitions are enforced
 * by `tool-lifecycle.ts`:
 *
 *   draft     → staged       (validation passes, owner has not yet acted)
 *   staged    → live         (owner approval; T2 also requires signed gate)
 *   live      → archived     (owner archives or auto-archive on disuse)
 *   draft     → archived     (owner discards before staging)
 *   staged    → archived     (owner discards after staging)
 *
 * No transition allowed FROM `archived` — archived is terminal.
 */
export type ToolLifecycle = 'draft' | 'staged' | 'live' | 'archived';

/**
 * Authority tier. T1 = read-only / informational tool, allowed by
 * default. T2 = mutating or scope-crossing, requires owner sign per
 * MUTATION_AUTHORITY_SPEC.
 */
export type AuthorityTier = 'T1' | 'T2';

// ---------------------------------------------------------------------------
// Tool spec — the immutable bundle the generator emits
// ---------------------------------------------------------------------------

/** Shape of a single form field in the generated tool's form schema. */
export interface ToolFormField {
  readonly name: string;
  readonly label: string;
  readonly kind: 'text' | 'number' | 'date' | 'select' | 'boolean';
  readonly required: boolean;
  readonly options?: ReadonlyArray<string>;
}

/** Shape of the generated tool's form schema. */
export interface ToolFormSchema {
  readonly title: string;
  readonly fields: ReadonlyArray<ToolFormField>;
}

/**
 * Handler descriptor. The actual function body lives behind the
 * generator's runtime port (see `generator/spec-generator.ts`). The
 * spec stores only the *signature* the runtime must satisfy:
 *
 *   inputs: { [field.name]: value }
 *   outputs: a structured payload (jsonb-shaped)
 *
 * The handler is reduced to a serialisable descriptor here.
 */
export interface ToolHandlerDescriptor {
  /** Stable handler identifier — used by the runner to dispatch. */
  readonly handlerId: string;
  /** Names of the fields the handler reads. */
  readonly readsFields: ReadonlyArray<string>;
  /** Names of the data sources the handler reads (e.g. 'worker_shifts'). */
  readonly readsSources: ReadonlyArray<string>;
  /** Names of the data sources the handler writes to (T2 only). */
  readonly writesSources: ReadonlyArray<string>;
}

/**
 * Dashboard archetype — which display archetype the generator chose.
 * Aligned with `@borjie/ephemeral-ui` DASHBOARD_ARCHETYPES.
 */
export type DashboardArchetypeName =
  | 'kpi-grid'
  | 'time-series-chart'
  | 'table'
  | 'detail-card'
  | 'list-with-detail';

/**
 * The sealed bundle. Once persisted, the spec is immutable; updates
 * require a new tool ID. This mirrors the recipe-shape immutability
 * from @borjie/dynamic-ui.
 */
export interface ToolSpec {
  readonly form: ToolFormSchema;
  readonly handler: ToolHandlerDescriptor;
  readonly archetype: DashboardArchetypeName;
  readonly auditHook: ToolAuditHook;
}

/**
 * Audit-hook descriptor — every tool run emits an entry that links
 * into the global audit-hash chain. The hook records which actor ran
 * the tool, with what inputs, and produces a fingerprint hash.
 */
export interface ToolAuditHook {
  /** Whether the audit hook is enabled (default true; never disable for T2). */
  readonly enabled: boolean;
  /** Names of input fields to redact from the audit log. */
  readonly redactFields: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Domain records — one type per row
// ---------------------------------------------------------------------------

export interface InternalTool {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly kind: ToolKind;
  readonly spec: ToolSpec;
  readonly lifecycleState: ToolLifecycle;
  readonly authorityTier: AuthorityTier;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
  readonly auditHash: string;
  readonly prevHash: string;
}

export interface ToolRun {
  readonly id: string;
  readonly toolId: string;
  readonly tenantId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly ranBy: string;
  readonly ranAt: Date;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Generation request
// ---------------------------------------------------------------------------

/**
 * What the owner says, plus the tenant context. The generator's
 * spec-gen port turns this into a ToolSpec.
 */
export interface GenerateToolRequest {
  readonly tenantId: string;
  readonly ownerUtterance: string;
  readonly desiredKind?: ToolKind;
}

/** A draft tool the runner can stage + later go-live. */
export interface DraftTool {
  readonly name: string;
  readonly kind: ToolKind;
  readonly spec: ToolSpec;
  readonly authorityTier: AuthorityTier;
}

// ---------------------------------------------------------------------------
// Runner request — execute a live tool
// ---------------------------------------------------------------------------

export interface RunToolRequest {
  readonly tenantId: string;
  readonly toolId: string;
  readonly ranBy: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * Port the runner calls to actually execute the tool's handler. The
 * caller injects the real binding (a workflow runtime, a query
 * engine, etc.); tests pass a deterministic stub.
 */
export type ToolHandlerPort = (input: {
  readonly tool: InternalTool;
  readonly inputs: Readonly<Record<string, unknown>>;
}) => Promise<Readonly<Record<string, unknown>>>;

// ---------------------------------------------------------------------------
// Repository contracts
// ---------------------------------------------------------------------------

export interface InternalToolRepository {
  insert(input: {
    readonly tenantId: string;
    readonly name: string;
    readonly kind: ToolKind;
    readonly spec: ToolSpec;
    readonly authorityTier: AuthorityTier;
  }): Promise<InternalTool>;
  transitionLifecycle(
    tenantId: string,
    id: string,
    next: ToolLifecycle,
  ): Promise<InternalTool>;
  findById(tenantId: string, id: string): Promise<InternalTool | null>;
  listForTenant(
    tenantId: string,
    filter?: { readonly lifecycleState?: ToolLifecycle; readonly kind?: ToolKind },
  ): Promise<ReadonlyArray<InternalTool>>;
}

export interface ToolRunRepository {
  insert(input: {
    readonly toolId: string;
    readonly tenantId: string;
    readonly inputs: Readonly<Record<string, unknown>>;
    readonly outputs: Readonly<Record<string, unknown>>;
    readonly ranBy: string;
  }): Promise<ToolRun>;
  listForTool(
    tenantId: string,
    toolId: string,
    limit: number,
  ): Promise<ReadonlyArray<ToolRun>>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INTERNAL_TOOL_CONSTANTS = Object.freeze({
  /** A tool must reach `live` before runs are allowed. */
  RUNNABLE_LIFECYCLE: 'live' as ToolLifecycle,
  /**
   * Lifecycle transitions allowed by the state machine. Outer keys =
   * from-state, inner array = allowed to-states. `archived` is terminal.
   */
  ALLOWED_TRANSITIONS: Object.freeze({
    draft: Object.freeze(['staged', 'archived'] as ReadonlyArray<ToolLifecycle>),
    staged: Object.freeze(['live', 'archived'] as ReadonlyArray<ToolLifecycle>),
    live: Object.freeze(['archived'] as ReadonlyArray<ToolLifecycle>),
    archived: Object.freeze([] as ReadonlyArray<ToolLifecycle>),
  }) as Readonly<Record<ToolLifecycle, ReadonlyArray<ToolLifecycle>>>,
});
