/**
 * Tests — HR CSV-ingest junior. End-to-end via a fake schema registry
 * so we cover the full executor → junior → diff → registry path.
 */

import { describe, expect, it } from "vitest";

import type { SchemaRegistryService } from "../../schema-registry/schema-registry-service";
import type { FieldProposalInput } from "../../schema-registry/types";
import { hrCsvIngestJunior } from "../agents/hr-csv-ingest";
import type { JuniorRunContext } from "../types";

const ORG = "00000000-0000-0000-0000-000000000020";

function ctx(args: {
  csv: string;
  source?: string;
  proposed?: FieldProposalInput[];
}): JuniorRunContext {
  const proposed = args.proposed ?? [];
  const registry: SchemaRegistryService = {
    async proposeField({ proposal }) {
      proposed.push(proposal);
      return { ok: true, proposalId: `p-${proposed.length}` };
    },
    async approveField() {
      return { ok: true, proposalId: "p", fieldId: "f" };
    },
    async rejectField() {
      return { ok: true };
    },
    async listPending() {
      return [];
    },
    async listLiveFields() {
      return [];
    },
  };
  return {
    orgId: ORG,
    juniorId: "hr-csv-ingest",
    triggerKind: "manual",
    payload: {
      tableKey: "employees",
      csv: args.csv,
      source: args.source ?? "employees-2026-05.csv",
    },
    schemaRegistry: registry,
    guardrails: hrCsvIngestJunior.guardrails,
    signal: new AbortController().signal,
    runId: "test-run",
  };
}

describe("hr-csv-ingest junior", () => {
  it("proposes new columns from a CSV upload", async () => {
    const proposed: FieldProposalInput[] = [];
    const csv = [
      "name,role,shift_pattern,transport_stipend",
      "Alice,Engineer,morning,15000",
      "Bob,Designer,evening,12000",
      "Charlie,Engineer,morning,15000",
      "Diana,Ops,evening,12000",
    ].join("\n");
    const result = await hrCsvIngestJunior.execute(ctx({ csv, proposed }));
    expect(result.outcome).toBe("ok");
    expect(result.proposalsFiled).toBe(2);
    expect(proposed.map((p) => p.fieldKey).sort()).toEqual([
      "shift_pattern",
      "transport_stipend",
    ]);
    expect(result.summary).toMatch(/Filed 2 field proposals/);
  });

  it("reports zero proposals when CSV matches the static schema", async () => {
    const csv = "name,role\nAlice,Engineer\nBob,Designer\n";
    const result = await hrCsvIngestJunior.execute(ctx({ csv }));
    expect(result.outcome).toBe("ok");
    expect(result.proposalsFiled).toBe(0);
    expect(result.summary).toMatch(/matches the current employees schema/i);
  });

  it("respects guardrails.maxProposalsPerRun cap", async () => {
    const proposed: FieldProposalInput[] = [];
    const headers = [
      "name",
      ...Array.from({ length: 30 }, (_, i) => `col_${i}`),
    ];
    const row = headers.map(() => "x").join(",");
    const csv = `${headers.join(",")}\n${row}\n${row}\n`;
    const result = await hrCsvIngestJunior.execute(ctx({ csv, proposed }));
    expect(result.proposalsFiled).toBeLessThanOrEqual(
      hrCsvIngestJunior.guardrails.maxProposalsPerRun,
    );
  });

  it("aborts cleanly when signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const c = ctx({ csv: "name,role\nAlice,Eng\n" });
    const aborted: JuniorRunContext = { ...c, signal: ac.signal };
    const result = await hrCsvIngestJunior.execute(aborted);
    expect(result.outcome).toBe("error");
    expect(result.errorMessage).toMatch(/aborted/);
  });

  it("payload schema rejects oversize csv", () => {
    const huge = "name\n" + "x\n".repeat(2_000_000);
    const r = hrCsvIngestJunior.payloadSchema.safeParse({
      tableKey: "employees",
      csv: huge,
      source: "x",
    });
    expect(r.success).toBe(false);
  });
});
