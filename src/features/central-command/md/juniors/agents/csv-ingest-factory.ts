/**
 * Generic CSV-ingest junior factory.
 *
 * Stamps out a domain-shaped junior given:
 *   - id           — stable identifier (e.g. "hr-csv-ingest")
 *   - label        — human label
 *   - domain       — MD planner routing key (hr/finance/...)
 *   - tableKey     — schema-registry table to file proposals against
 *   - staticColumns — codebase-hard-coded columns for that table
 *   - guardrails   — optional override of the defaults
 *
 * The factory means EVERY domain gets the same security posture:
 *   - 2 MB payload cap
 *   - 5 000 rows / run hard cap
 *   - 16 proposals / run cap (guardrail-enforced)
 *   - 30 s cooldown per (org, junior)
 *   - 20 s wall-clock budget
 *   - Abort-signal-aware execution
 *
 * Anything domain-specific (e.g. different staticColumns) is data, not
 * code. New domains drop in by registering a new `makeCsvIngestJunior`
 * invocation in `agents/index.ts` — no new module needed.
 *
 * @module features/central-command/md/juniors/agents/csv-ingest-factory
 */

import { z } from "zod";

import { diffCsvAgainstSchema } from "../../schema-registry/csv-schema-diff";
import type { TableKey } from "../../schema-registry/types";
import type {
  Guardrails,
  JuniorRunContext,
  JuniorRunResult,
  MdJuniorPort,
} from "../types";

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2 MB

export interface CsvIngestJuniorSpec {
  readonly id: string;
  readonly label: string;
  readonly domain: MdJuniorPort["domain"];
  readonly tableKey: TableKey;
  readonly staticColumns: ReadonlyArray<string>;
  readonly description?: string;
  readonly guardrails?: Partial<Guardrails>;
}

const DEFAULT_GUARDRAILS: Guardrails = Object.freeze({
  maxRowsPerRun: 5_000,
  maxProposalsPerRun: 16,
  cooldownMs: 30_000,
  maxDurationMs: 20_000,
  allowedTables: [],
});

/**
 * Build the per-instance payload schema. Each junior accepts a literal
 * `tableKey` so the planner can route correctly, the raw `csv` text,
 * and a `source` description used in the proposal rationale.
 */
function buildPayloadSchema(tableKey: TableKey) {
  return z.object({
    tableKey: z.literal(tableKey),
    csv: z.string().min(1).max(MAX_CSV_BYTES, "csv exceeds 2MB limit"),
    source: z.string().min(1).max(200),
    maxProposals: z.number().int().positive().max(64).optional(),
  });
}

/**
 * Construct an MdJuniorPort that performs CSV → schema-diff → propose.
 *
 * The returned object is frozen; the factory is pure (no closure over
 * mutable state).
 */
export function makeCsvIngestJunior(spec: CsvIngestJuniorSpec): MdJuniorPort {
  const payloadSchema = buildPayloadSchema(spec.tableKey);
  const guardrails: Guardrails = Object.freeze({
    ...DEFAULT_GUARDRAILS,
    ...spec.guardrails,
    allowedTables: [spec.tableKey] as TableKey[],
  });

  const port: MdJuniorPort = {
    id: spec.id,
    label: spec.label,
    domain: spec.domain,
    trigger: { kind: "manual" as const, invokedBy: "md.chat" },
    guardrails,
    payloadSchema,
    description:
      spec.description ??
      `Parses an uploaded ${spec.tableKey} CSV, diffs it against the live + static ${spec.tableKey} schema, and files field proposals for new columns (awaiting owner approval).`,

    async execute(ctx: JuniorRunContext): Promise<JuniorRunResult> {
      type ParsedPayload = z.infer<ReturnType<typeof buildPayloadSchema>>;
      const payload = ctx.payload as ParsedPayload;

      // Abort defence — the executor may have already burned our budget
      // while we were queued behind a previous junior.
      if (ctx.signal.aborted) {
        return {
          outcome: "error",
          proposalsFiled: 0,
          rowsProcessed: 0,
          tableKey: spec.tableKey,
          summary: `junior "${ctx.juniorId}" aborted before start`,
          errorMessage: "aborted_before_start",
        };
      }

      const liveFields = await ctx.schemaRegistry.listLiveFields(
        ctx.orgId,
        spec.tableKey,
      );

      const diff = diffCsvAgainstSchema({
        orgId: ctx.orgId,
        tableKey: spec.tableKey,
        csv: payload.csv,
        staticColumns: spec.staticColumns,
        liveFields,
        proposerId: ctx.juniorId,
        source: payload.source,
        maxProposals: payload.maxProposals ?? ctx.guardrails.maxProposalsPerRun,
      });

      if (diff.proposals.length === 0) {
        return {
          outcome: "ok",
          proposalsFiled: 0,
          rowsProcessed: diff.confirmedExisting.length,
          tableKey: spec.tableKey,
          summary:
            diff.confirmedExisting.length > 0
              ? `Upload "${payload.source}" matches the current ${spec.tableKey} schema — no new fields proposed.`
              : `Upload "${payload.source}" produced no usable headers.`,
        };
      }

      let filed = 0;
      const filedKeys: string[] = [];
      for (const proposal of diff.proposals) {
        if (ctx.signal.aborted) break;
        if (filed >= ctx.guardrails.maxProposalsPerRun) break;
        const result = await ctx.schemaRegistry.proposeField({ proposal });
        if (result.ok) {
          filed += 1;
          filedKeys.push(proposal.fieldKey);
        }
      }

      return {
        outcome: "ok",
        proposalsFiled: filed,
        rowsProcessed: diff.proposals.length + diff.confirmedExisting.length,
        tableKey: spec.tableKey,
        summary: buildSummary(
          payload.source,
          filedKeys,
          diff.confirmedExisting.length,
          spec.tableKey,
        ),
      };
    },
  };
  return Object.freeze(port);
}

// ---------------------------------------------------------------------------
// Summary builder — same shape across all juniors so the MD chat renders
// consistently.
// ---------------------------------------------------------------------------

function buildSummary(
  source: string,
  filedKeys: ReadonlyArray<string>,
  confirmedCount: number,
  tableKey: TableKey,
): string {
  if (filedKeys.length === 0) {
    return `Upload "${source}" produced no new proposals for ${tableKey} (confirmed ${confirmedCount} existing fields).`;
  }
  const list =
    filedKeys.length <= 4
      ? filedKeys.join(", ")
      : `${filedKeys.slice(0, 4).join(", ")}, +${filedKeys.length - 4} more`;
  return `Filed ${filedKeys.length} field proposal${
    filedKeys.length === 1 ? "" : "s"
  } against the ${tableKey} schema from "${source}": ${list}. Awaiting owner approval.`;
}
