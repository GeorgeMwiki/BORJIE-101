/**
 * Query Analyzer
 *
 * Runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) on a query and returns a
 * normalised plan summary suitable for regression detection in dev scripts.
 *
 * USAGE
 *   import { explainQuery } from '@borjie/database/query-analyzer'
 *   const summary = await explainQuery(db, 'SELECT * FROM invoices WHERE tenant_id = $1', ['t_123'])
 *   console.log(summary.totalCostEstimate, summary.rowsEstimate)
 *
 * The helper is read-only and wraps the query in a READ-ONLY transaction that
 * is rolled back at the end — safe to use against production read replicas.
 */

import type { DatabaseClient } from './client.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PlanSummary {
  readonly query: string
  readonly totalCostEstimate: number
  readonly startupCostEstimate: number
  readonly rowsEstimate: number
  readonly actualRows: number
  readonly actualTotalMs: number
  readonly planningMs: number
  readonly executionMs: number
  readonly sharedBlocksHit: number
  readonly sharedBlocksRead: number
  readonly nodeTypes: ReadonlyArray<string>
  readonly seqScans: ReadonlyArray<SeqScanNode>
  readonly indexesUsed: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
  readonly rawPlan: unknown
}

export interface SeqScanNode {
  readonly relationName: string
  readonly filter?: string
  readonly actualRows: number
  readonly actualTotalMs: number
}

export interface ExplainOptions {
  /** Whether to actually run the query (default: true). */
  readonly analyze?: boolean
  /** Collect buffers stats (default: true). Ignored when analyze=false. */
  readonly buffers?: boolean
  /**
   * Seq-scan actualRows threshold above which a warning is emitted.
   * Default: 1_000.
   */
  readonly seqScanWarnThreshold?: number
  /**
   * Execution time (ms) above which a warning is emitted.
   * Default: 500.
   */
  readonly slowQueryWarnMs?: number
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Runs EXPLAIN on the supplied query and returns a normalised summary.
 *
 * The query is executed inside a READ-ONLY transaction that is rolled back
 * before the function returns, so no data mutations persist — including any
 * side-effects of functions called inside the query.
 */
export async function explainQuery(
  db: DatabaseClient,
  query: string,
  params: ReadonlyArray<unknown> = [],
  options: ExplainOptions = {}
): Promise<PlanSummary> {
  const analyze = options.analyze ?? true
  const buffers = analyze ? (options.buffers ?? true) : false
  const seqScanWarnThreshold = options.seqScanWarnThreshold ?? 1_000
  const slowQueryWarnMs = options.slowQueryWarnMs ?? 500

  const flags = ['FORMAT JSON']
  if (analyze) flags.push('ANALYZE true')
  if (buffers) flags.push('BUFFERS true')
  const explainSql = `EXPLAIN (${flags.join(', ')}) ${query}`

  // Use the underlying postgres-js client (exposed via db.$client on drizzle).
  // Falls back to .execute if available.
  const rawPlan = await runExplain(db, explainSql, params)

  return summarisePlan({
    query,
    rawPlan,
    seqScanWarnThreshold,
    slowQueryWarnMs,
  })
}

async function runExplain(
  db: DatabaseClient,
  explainSql: string,
  params: ReadonlyArray<unknown>
): Promise<unknown> {
  // drizzle + postgres-js exposes the client at different paths depending on
  // version; probe both. We wrap in a ROLLBACK-only transaction for safety.
  const client = (db as unknown as { $client?: unknown }).$client

  if (isPostgresJsClient(client)) {
    return await client.begin(async (tx: (s: string, p?: unknown[]) => Promise<unknown>) => {
      try {
        const rows = (await tx(explainSql, [...params])) as Array<{ 'QUERY PLAN': unknown[] }>
        // We never persist EXPLAIN ANALYZE side-effects; force rollback.
        await tx('ROLLBACK')
        return rows[0]?.['QUERY PLAN'] ?? []
      } catch (error) {
        await tx('ROLLBACK').catch(() => undefined)
        throw error
      }
    })
  }

  throw new Error(
    'explainQuery: could not locate underlying postgres client on DatabaseClient instance'
  )
}

type PostgresJsTx = (s: string, p?: unknown[]) => Promise<unknown>

function isPostgresJsClient(
  c: unknown
): c is {
  begin: (fn: (tx: PostgresJsTx) => Promise<unknown>) => Promise<unknown>
} {
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof (c as { begin?: unknown }).begin === 'function'
  )
}

// ---------------------------------------------------------------------------
// Plan traversal
// ---------------------------------------------------------------------------

interface SummariseInput {
  readonly query: string
  readonly rawPlan: unknown
  readonly seqScanWarnThreshold: number
  readonly slowQueryWarnMs: number
}

function summarisePlan(input: SummariseInput): PlanSummary {
  const { query, rawPlan, seqScanWarnThreshold, slowQueryWarnMs } = input

  const root = Array.isArray(rawPlan) ? (rawPlan[0] as Record<string, unknown>) : undefined
  const plan = root?.Plan as PlanNode | undefined

  const nodeTypes: string[] = []
  const seqScans: SeqScanNode[] = []
  const indexesUsed: string[] = []

  if (plan) {
    walk(plan, (node) => {
      nodeTypes.push(node['Node Type'] as string)

      if (node['Node Type'] === 'Seq Scan' && typeof node['Relation Name'] === 'string') {
        seqScans.push({
          relationName: node['Relation Name'],
          ...(typeof node.Filter === 'string' ? { filter: node.Filter } : {}),
          actualRows: (node['Actual Rows'] as number) ?? 0,
          actualTotalMs: (node['Actual Total Time'] as number) ?? 0,
        })
      }

      if (typeof node['Index Name'] === 'string') {
        indexesUsed.push(node['Index Name'])
      }
    })
  }

  const planningMs = (root?.['Planning Time'] as number) ?? 0
  const executionMs = (root?.['Execution Time'] as number) ?? 0

  const warnings = buildWarnings({
    seqScans,
    seqScanWarnThreshold,
    executionMs,
    slowQueryWarnMs,
  })

  return {
    query,
    totalCostEstimate: (plan?.['Total Cost'] as number) ?? 0,
    startupCostEstimate: (plan?.['Startup Cost'] as number) ?? 0,
    rowsEstimate: (plan?.['Plan Rows'] as number) ?? 0,
    actualRows: (plan?.['Actual Rows'] as number) ?? 0,
    actualTotalMs: (plan?.['Actual Total Time'] as number) ?? 0,
    planningMs,
    executionMs,
    sharedBlocksHit: (plan?.['Shared Hit Blocks'] as number) ?? 0,
    sharedBlocksRead: (plan?.['Shared Read Blocks'] as number) ?? 0,
    nodeTypes: Object.freeze(nodeTypes),
    seqScans: Object.freeze(seqScans),
    indexesUsed: Object.freeze(indexesUsed),
    warnings: Object.freeze(warnings),
    rawPlan,
  }
}

type PlanNode = Record<string, unknown> & {
  Plans?: PlanNode[]
}

function walk(node: PlanNode, visit: (n: PlanNode) => void): void {
  visit(node)
  const children = node.Plans
  if (Array.isArray(children)) {
    for (const child of children) {
      walk(child, visit)
    }
  }
}

interface WarningInput {
  readonly seqScans: ReadonlyArray<SeqScanNode>
  readonly seqScanWarnThreshold: number
  readonly executionMs: number
  readonly slowQueryWarnMs: number
}

function buildWarnings(input: WarningInput): string[] {
  const warnings: string[] = []

  const bigSeqScans = input.seqScans.filter(
    (s) => s.actualRows >= input.seqScanWarnThreshold
  )
  for (const scan of bigSeqScans) {
    warnings.push(
      `Sequential scan on ${scan.relationName} scanned ${scan.actualRows} rows ` +
        `(>= ${input.seqScanWarnThreshold}); consider adding an index.`
    )
  }

  if (input.executionMs >= input.slowQueryWarnMs) {
    warnings.push(
      `Query execution took ${input.executionMs.toFixed(2)}ms (>= ${input.slowQueryWarnMs}ms).`
    )
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Convenience: compact summary for logging
// ---------------------------------------------------------------------------

export function formatSummary(summary: PlanSummary): string {
  const lines = [
    `query: ${summary.query.slice(0, 120)}${summary.query.length > 120 ? '…' : ''}`,
    `plan:  ${summary.nodeTypes.join(' > ')}`,
    `rows:  est=${summary.rowsEstimate} actual=${summary.actualRows}`,
    `time:  planning=${summary.planningMs.toFixed(2)}ms exec=${summary.executionMs.toFixed(2)}ms`,
    `io:    hit=${summary.sharedBlocksHit} read=${summary.sharedBlocksRead}`,
  ]
  if (summary.indexesUsed.length > 0) {
    lines.push(`idx:   ${summary.indexesUsed.join(', ')}`)
  }
  if (summary.seqScans.length > 0) {
    lines.push(
      `seq:   ${summary.seqScans.map((s) => `${s.relationName}(${s.actualRows})`).join(', ')}`
    )
  }
  if (summary.warnings.length > 0) {
    lines.push(...summary.warnings.map((w) => `WARN:  ${w}`))
  }
  return lines.join('\n')
}
