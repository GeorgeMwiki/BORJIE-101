/**
 * Wave-3-int2 — Unified dispatcher entry point.
 *
 * This module wraps the existing `dispatchToTabs` in `dispatch.ts` with:
 *   1. Tenant-override routing-rule loading (DB → matrix).
 *   2. OpenTelemetry span instrumentation around the dispatch turn.
 *   3. A bulk-op safety check: any matrix row whose action begins with
 *      `bulk_` is forced to `hitl_required = true` regardless of the
 *      tenant-override row's flag, satisfying the "bulk operations
 *      always require HITL" hard rule.
 *
 * The wrapper preserves the original `dispatchToTabs` purity — callers
 * can still import that directly when they want the matrix-agnostic
 * primitive. New code should prefer `runDispatchPipeline` because it
 * encodes the platform's safety rules.
 */

import { trace, type Span, SpanStatusCode } from '@opentelemetry/api';
import { dispatchToTabs, type DispatchDeps } from './dispatch.js';
import { PLATFORM_ROUTING_MATRIX } from './matrix-defaults.js';
import type {
  AcceptHandlerRegistry,
  ConversationCapture,
  ModuleUpdateProposal,
  PersonaContext,
  RoutingMatrixRow,
} from './types.js';

const TRACER_NAME = '@borjie/dispatch-router';

// ─── Tenant-override routing loader port ──────────────────────────────────

export interface RoutingRulesLoader {
  /**
   * Read the persisted `routing_rules` for a tenant. Implementations:
   *   - Drizzle adapter (production): `SELECT ... FROM routing_rules
   *     WHERE tenant_scope IN ($tenant_id, '*')`.
   *   - In-memory (tests): a Map<tenant_id, RoutingMatrixRow[]>.
   *
   * Returns `[]` when the tenant has no override rows (the wrapper then
   * falls through to the PLATFORM_ROUTING_MATRIX defaults).
   */
  loadForTenant(tenant_id: string): Promise<ReadonlyArray<RoutingMatrixRow>>;
}

/**
 * In-memory loader for tests + the dev composition. Mutable so tests
 * can seed tenant overrides; production wires a Drizzle-backed loader.
 */
export interface InMemoryRoutingRulesStore {
  readonly add: (row: RoutingMatrixRow) => void;
  readonly clear: (tenant_id?: string) => void;
}

export function createInMemoryRoutingRulesLoader(): {
  readonly loader: RoutingRulesLoader;
  readonly store: InMemoryRoutingRulesStore;
} {
  const rows: RoutingMatrixRow[] = [];

  const loader: RoutingRulesLoader = {
    async loadForTenant(tenant_id) {
      return rows.filter(
        (r) => r.tenant_scope === tenant_id || r.tenant_scope === '*',
      );
    },
  };

  const store: InMemoryRoutingRulesStore = {
    add(row) {
      rows.push(row);
    },
    clear(tenant_id) {
      if (tenant_id) {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]?.tenant_scope === tenant_id) rows.splice(i, 1);
        }
      } else {
        rows.length = 0;
      }
    },
  };

  return { loader, store };
}

// ─── OTel hooks ───────────────────────────────────────────────────────────

interface OtelHooks {
  readonly tracer: ReturnType<typeof trace.getTracer>;
}

function getOtelHooks(): OtelHooks {
  return { tracer: trace.getTracer(TRACER_NAME) };
}

async function withSpan<T>(
  spanName: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const { tracer } = getOtelHooks();
  return tracer.startActiveSpan(spanName, async (span) => {
    for (const [k, v] of Object.entries(attributes)) {
      span.setAttribute(k, v);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      span.recordException(err instanceof Error ? err : new Error(message));
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// ─── Merge platform-default + tenant-override matrix ──────────────────────

/**
 * Merge platform defaults with tenant overrides. Tenant overrides win
 * on (entity_type, intent) conflict. Bulk-op rows are forced HITL.
 */
export function mergeMatrices(
  platformDefault: ReadonlyArray<RoutingMatrixRow>,
  tenantOverrides: ReadonlyArray<RoutingMatrixRow>,
): ReadonlyArray<RoutingMatrixRow> {
  const out = new Map<string, RoutingMatrixRow>();
  // Seed with platform defaults.
  for (const row of platformDefault) {
    out.set(matrixKey(row), enforceBulkHitl(row));
  }
  // Tenant overrides win on same (entity_type, intent).
  for (const row of tenantOverrides) {
    if (row.tenant_scope === '*') continue; // platform default — already seeded
    out.set(matrixKey(row), enforceBulkHitl(row));
  }
  return Array.from(out.values());
}

function matrixKey(row: RoutingMatrixRow): string {
  return `${row.entity_type}::${row.intent}::${row.module_template_id}::${row.action}`;
}

/**
 * If the action begins with `bulk_`, force `hitl_required = true`. This
 * is a platform-level invariant — a tenant cannot override their way
 * past the bulk-op HITL gate.
 */
function enforceBulkHitl(row: RoutingMatrixRow): RoutingMatrixRow {
  if (row.action.startsWith('bulk_') && !row.hitl_required) {
    return { ...row, hitl_required: true };
  }
  return row;
}

// ─── runDispatchPipeline — the public composed entry point ────────────────

export interface RunDispatchPipelineInput {
  readonly tenant_id: string;
  readonly capture: ConversationCapture;
  readonly persona: PersonaContext;
  /** Optional override of the platform default. Tests use this. */
  readonly platformDefaultMatrix?: ReadonlyArray<RoutingMatrixRow>;
}

export interface RunDispatchPipelineDeps extends DispatchDeps {
  readonly routingRules: RoutingRulesLoader;
  readonly handlerRegistry: AcceptHandlerRegistry;
}

export interface RunDispatchPipelineResult {
  readonly proposals: ReadonlyArray<ModuleUpdateProposal>;
  readonly matrixSize: number;
  readonly tenantOverrideCount: number;
}

/**
 * Compose the dispatch pipeline:
 *   1. Load tenant-override rows from routing_rules.
 *   2. Merge with platform defaults (overrides win; bulk-ops forced HITL).
 *   3. Wrap in an OTel span keyed on tenant + capture id.
 *   4. Delegate to `dispatchToTabs` with the merged matrix.
 *   5. Return proposal list + matrix size diagnostics.
 *
 * Callers must inject all DispatchDeps + the routingRules loader +
 * the live handler registry.
 */
export async function runDispatchPipeline(
  input: RunDispatchPipelineInput,
  deps: RunDispatchPipelineDeps,
): Promise<RunDispatchPipelineResult> {
  const platformDefault = input.platformDefaultMatrix ?? PLATFORM_ROUTING_MATRIX;
  const tenantOverrides = await deps.routingRules.loadForTenant(input.tenant_id);
  const merged = mergeMatrices(platformDefault, tenantOverrides);

  return withSpan(
    'dispatch_router.run_pipeline',
    {
      'dispatch.tenant_id': input.tenant_id,
      'dispatch.capture_id': input.capture.id,
      'dispatch.persona_id': input.persona.persona_id,
      'dispatch.persona_tier': input.persona.tier,
      'dispatch.intent': input.capture.intent,
      'dispatch.entity_count': input.capture.entities.length,
      'dispatch.matrix_size': merged.length,
      'dispatch.tenant_override_count': tenantOverrides.length,
    },
    async (span) => {
      const proposals = await dispatchToTabs(
        {
          tenant_id: input.tenant_id,
          capture: input.capture,
          persona: input.persona,
          matrix: merged,
          handlerRegistry: deps.handlerRegistry,
        },
        deps,
      );
      span.setAttribute('dispatch.proposals_count', proposals.length);
      const auto = proposals.filter((p) => p.status === 'auto_applying' || p.status === 'accepted').length;
      const hitl = proposals.filter((p) => p.status === 'pending_hitl').length;
      span.setAttribute('dispatch.proposals_auto', auto);
      span.setAttribute('dispatch.proposals_pending_hitl', hitl);
      return {
        proposals,
        matrixSize: merged.length,
        tenantOverrideCount: tenantOverrides.length,
      };
    },
  );
}
