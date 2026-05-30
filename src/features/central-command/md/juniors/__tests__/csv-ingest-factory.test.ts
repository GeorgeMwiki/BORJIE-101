/**
 * Tests — CSV-ingest junior factory. Verifies that:
 *  - every produced junior carries the spec's id/label/domain/tableKey
 *  - payload schema enforces the correct literal tableKey
 *  - guardrails defaults + overrides apply correctly
 *  - execute() routes proposals through the registry stub
 */

import { describe, expect, it } from "vitest";

import type { SchemaRegistryService } from "../../schema-registry/schema-registry-service";
import type { FieldProposalInput } from "../../schema-registry/types";
import { makeCsvIngestJunior } from "../agents/csv-ingest-factory";
import { ALL_DOMAIN_CSV_JUNIORS } from "../agents/domain-juniors";
import type { JuniorRunContext } from "../types";

const ORG = "00000000-0000-0000-0000-000000000033";

function fakeRegistry(): {
  service: SchemaRegistryService;
  filed: FieldProposalInput[];
} {
  const filed: FieldProposalInput[] = [];
  const service: SchemaRegistryService = {
    async proposeField({ proposal }) {
      filed.push(proposal);
      return { ok: true, proposalId: `p-${filed.length}` };
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
  return { service, filed };
}

function ctx(args: {
  service: SchemaRegistryService;
  csv: string;
  tableKey: import("../../schema-registry/types").TableKey;
}): JuniorRunContext {
  return {
    orgId: ORG,
    juniorId: "test-junior",
    triggerKind: "manual",
    payload: {
      tableKey: args.tableKey,
      csv: args.csv,
      source: "test-upload.csv",
    },
    schemaRegistry: args.service,
    guardrails: {
      maxRowsPerRun: 100,
      maxProposalsPerRun: 16,
      cooldownMs: 0,
      maxDurationMs: 5_000,
      allowedTables: [args.tableKey],
    },
    signal: new AbortController().signal,
    runId: "run",
  };
}

describe("makeCsvIngestJunior", () => {
  it("propagates spec fields to the produced port", () => {
    const j = makeCsvIngestJunior({
      id: "my-test-junior",
      label: "My Test Junior",
      domain: "finance",
      tableKey: "finance",
      staticColumns: ["id", "amount"],
    });
    expect(j.id).toBe("my-test-junior");
    expect(j.label).toBe("My Test Junior");
    expect(j.domain).toBe("finance");
    expect(j.guardrails.allowedTables).toEqual(["finance"]);
    expect(j.trigger.kind).toBe("manual");
  });

  it("payload schema enforces literal tableKey", () => {
    const j = makeCsvIngestJunior({
      id: "x",
      label: "X",
      domain: "ops",
      tableKey: "suppliers",
      staticColumns: ["id"],
    });
    const ok = j.payloadSchema.safeParse({
      tableKey: "suppliers",
      csv: "id\n1\n",
      source: "x.csv",
    });
    expect(ok.success).toBe(true);
    const wrong = j.payloadSchema.safeParse({
      tableKey: "employees",
      csv: "id\n1\n",
      source: "x.csv",
    });
    expect(wrong.success).toBe(false);
  });

  it("files proposals via the registry on execute", async () => {
    const j = makeCsvIngestJunior({
      id: "x",
      label: "X",
      domain: "ops",
      tableKey: "inventory",
      staticColumns: ["id", "sku"],
    });
    const reg = fakeRegistry();
    const csv = [
      "id,sku,new_field_a,new_field_b",
      "1,A,morning,10",
      "2,B,evening,20",
      "3,C,morning,30",
      "4,D,evening,40",
    ].join("\n");
    const result = await j.execute(
      ctx({ service: reg.service, csv, tableKey: "inventory" }),
    );
    expect(result.outcome).toBe("ok");
    expect(result.proposalsFiled).toBe(2);
    const keys = reg.filed.map((p) => p.fieldKey).sort();
    expect(keys).toEqual(["new_field_a", "new_field_b"]);
  });

  it("override guardrails win over defaults", () => {
    const j = makeCsvIngestJunior({
      id: "y",
      label: "Y",
      domain: "ops",
      tableKey: "customers",
      staticColumns: ["id"],
      guardrails: { cooldownMs: 0, maxProposalsPerRun: 2 },
    });
    expect(j.guardrails.cooldownMs).toBe(0);
    expect(j.guardrails.maxProposalsPerRun).toBe(2);
    // Defaults still apply for fields we didn't override.
    expect(j.guardrails.maxDurationMs).toBe(20_000);
  });
});

describe("domain-juniors", () => {
  it("ships exactly 7 non-employees domain juniors", () => {
    expect(ALL_DOMAIN_CSV_JUNIORS.length).toBe(7);
    const tableKeys = ALL_DOMAIN_CSV_JUNIORS.map(
      (j) => j.guardrails.allowedTables[0],
    );
    expect(new Set(tableKeys).size).toBe(7);
    expect(tableKeys).not.toContain("employees");
  });

  it("every junior id is unique + snake-kebab safe", () => {
    const ids = ALL_DOMAIN_CSV_JUNIORS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]+$/);
    }
  });
});
