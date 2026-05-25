/**
 * Power-Tool Registry — central catalogue.
 *
 * Every power-tool registers here at composition time. The orchestrator
 * looks up `power_tool.<id>` calls against this registry the same way it
 * does for the HQ-tier `HqToolSpec` registry, but the registry layer
 * applies extra invariants the HQ-tier doesn't need:
 *
 *   1. Tier gate — refuses with `TIER_TOO_LOW` when caller tier is
 *      below the tool's `requiredTier`.
 *   2. Approval gate — refuses with `APPROVAL_MISSING` when the tool
 *      declares `requiresApproval: true` and the orchestrator did not
 *      thread an `approvalRecordId` through the context.
 *   3. Schema validation — refuses with a Zod-derived error before the
 *      tool's `execute` fires. Bad input never reaches the tool body.
 *   4. Audit-row emission — every invocation, success or failure,
 *      lands a row at the destination the tool declared.
 *
 * The registry never registers two tools with the same id and never
 * mutates a registered spec.
 *
 * @module kernel/power-tools/registry
 */

import {
  meetsTier,
  type AnyPowerTool,
  type PowerTool,
  type PowerToolAuditRow,
  type PowerToolAuditSink,
  type PowerToolContext,
  type PowerToolResult,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Registry public surface
// ─────────────────────────────────────────────────────────────────────

export interface PowerToolRegistry {
  /** Register a power-tool. Throws on duplicate id / empty id. */
  register<I, O>(tool: PowerTool<I, O>): void;
  /** Lookup a registered spec, or `null` when unknown. */
  get(id: string): AnyPowerTool | null;
  /** All registered tools, sorted by id. */
  list(): ReadonlyArray<AnyPowerTool>;
  /** Filtered list — only tools the given tier can invoke. */
  listForTier(tier: PowerToolContext['tier']): ReadonlyArray<AnyPowerTool>;
  /**
   * Invoke a registered tool. Routes through the four guard layers
   * (tier, approval, schema, audit) before calling `execute`. The
   * result is the deterministic outcome the kernel surfaces to the
   * orchestrator.
   */
  invoke<O = unknown>(
    id: string,
    args: unknown,
    ctx: PowerToolContext,
  ): Promise<PowerToolResult<O>>;
  /** Reset the registry. Test rigs use this between cases. */
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPowerToolRegistry(): PowerToolRegistry {
  const tools = new Map<string, AnyPowerTool>();

  function register<I, O>(tool: PowerTool<I, O>): void {
    if (!tool.id || tool.id.trim().length === 0) {
      throw new Error('PowerToolRegistry.register: id is required');
    }
    if (tools.has(tool.id)) {
      throw new Error(
        `PowerToolRegistry.register: tool "${tool.id}" already registered`,
      );
    }
    // Cast through unknown — the heterogeneous map stores erased specs.
    tools.set(tool.id, tool as unknown as AnyPowerTool);
  }

  function get(id: string): AnyPowerTool | null {
    return tools.get(id) ?? null;
  }

  function list(): ReadonlyArray<AnyPowerTool> {
    return [...tools.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  function listForTier(
    tier: PowerToolContext['tier'],
  ): ReadonlyArray<AnyPowerTool> {
    return list().filter((tool) => meetsTier(tier, tool.requiredTier));
  }

  async function invoke<O = unknown>(
    id: string,
    args: unknown,
    ctx: PowerToolContext,
  ): Promise<PowerToolResult<O>> {
    const tool = tools.get(id);
    if (!tool) {
      return {
        kind: 'failed',
        message: `Unknown power tool: ${id}`,
      };
    }

    // Layer 1: tier gate.
    if (!meetsTier(ctx.tier, tool.requiredTier)) {
      const result: PowerToolResult<O> = {
        kind: 'refused',
        reasonCode: 'TIER_TOO_LOW',
        message: `power_tool.${tool.id} requires tier '${tool.requiredTier}'; caller is '${ctx.tier}'`,
      };
      await emitAudit(tool, ctx, args, result);
      return result;
    }

    // Layer 2: approval gate.
    if (tool.requiresApproval && ctx.approvalRecordId === null) {
      const result: PowerToolResult<O> = {
        kind: 'refused',
        reasonCode: 'APPROVAL_MISSING',
        message: `power_tool.${tool.id} requires four-eye approval; no approvalRecordId in context`,
      };
      await emitAudit(tool, ctx, args, result);
      return result;
    }

    // Layer 3: schema validation.
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const path = firstIssue?.path?.join('.') ?? '<root>';
      const message = firstIssue?.message ?? 'invalid args';
      const result: PowerToolResult<O> = {
        kind: 'failed',
        message: `power_tool.${tool.id} args invalid at "${path}": ${message}`,
      };
      await emitAudit(tool, ctx, args, result);
      return result;
    }

    // Dispatch.
    let outcome: PowerToolResult<O>;
    try {
      outcome = (await tool.execute(ctx, parsed.data)) as PowerToolResult<O>;
    } catch (err) {
      outcome = {
        kind: 'failed',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // Layer 4: audit row.
    await emitAudit(tool, ctx, parsed.data, outcome);
    return outcome;
  }

  function clear(): void {
    tools.clear();
  }

  return { register, get, list, listForTier, invoke, clear };
}

// ─────────────────────────────────────────────────────────────────────
// In-memory audit sink — test rig + dev surface
// ─────────────────────────────────────────────────────────────────────

export interface InMemoryPowerToolAuditSink extends PowerToolAuditSink {
  readonly rows: ReadonlyArray<PowerToolAuditRow>;
  clear(): void;
}

export function createInMemoryPowerToolAuditSink(): InMemoryPowerToolAuditSink {
  const rows: PowerToolAuditRow[] = [];
  return {
    async record(row: PowerToolAuditRow): Promise<void> {
      rows.push(row);
    },
    get rows(): ReadonlyArray<PowerToolAuditRow> {
      return rows;
    },
    clear(): void {
      rows.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function emitAudit<O>(
  tool: AnyPowerTool,
  ctx: PowerToolContext,
  args: unknown,
  result: PowerToolResult<O>,
): Promise<void> {
  if (!ctx.auditSink) return;
  if (tool.auditDestination === 'none') return;

  const outcome: PowerToolAuditRow['outcome'] =
    result.kind === 'ok'
      ? 'ok'
      : result.kind === 'refused'
        ? 'refused'
        : 'failed';

  const errorMessage =
    result.kind === 'ok'
      ? null
      : 'message' in result
        ? result.message
        : null;

  const outputJson = result.kind === 'ok' ? safeStringify(result.output) : null;

  const row: PowerToolAuditRow = {
    destination: tool.auditDestination,
    toolId: tool.id,
    tier: ctx.tier,
    callerId: ctx.callerId,
    tenantId: ctx.tenantId,
    inputJson: safeStringify(args),
    outputJson,
    outcome,
    errorMessage,
    approvalRecordId: ctx.approvalRecordId,
    at: ctx.clock().toISOString(),
  };

  try {
    await ctx.auditSink.record(row);
  } catch {
    // Audit emission is fire-and-forget — never block on persistence.
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserialisable]"';
  }
}
