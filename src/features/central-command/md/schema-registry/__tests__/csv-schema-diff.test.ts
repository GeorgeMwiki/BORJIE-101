/**
 * Tests — CSV schema-diff. Verifies kind sniffing, header
 * snake-casing, dedup, and that already-known columns are not
 * re-proposed.
 */

import { describe, expect, it } from "vitest";

import {
  diffCsvAgainstSchema,
  parseCsv,
  sniffKind,
  snakeCase,
  humanLabel,
} from "../csv-schema-diff";
import type { LiveField } from "../types";

const ORG = "00000000-0000-0000-0000-000000000001";

const liveField = (key: string): LiveField => ({
  id: `live-${key}`,
  orgId: ORG,
  tableKey: "employees",
  fieldKey: key,
  fieldLabel: key,
  fieldKind: "string",
  required: false,
  source: "manual",
  originProposalId: null,
  createdAt: "2026-05-01T00:00:00Z",
});

describe("parseCsv", () => {
  it("handles BOM, CRLF, quoted commas, escaped quotes", () => {
    const csv = '﻿name,role\r\n"Alice, A",Eng\r\n"Bob ""the Builder""",Ops\n';
    const rows = parseCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(["name", "role"]);
    expect(rows[1]).toEqual(["Alice, A", "Eng"]);
    expect(rows[2]).toEqual(['Bob "the Builder"', "Ops"]);
  });

  it("ignores blank rows", () => {
    const rows = parseCsv("a,b\n\n\nx,y\n");
    expect(rows.length).toBe(2);
  });

  it("returns empty array on empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("sniffKind", () => {
  it("detects percent before money", () => {
    expect(sniffKind(["12%", "5.5%", "-3%"]).kind).toBe("percent");
  });

  it("detects money with currency prefix/suffix", () => {
    expect(sniffKind(["TZS 1,200", "USD 50.00", "$200"]).kind).toBe("money");
  });

  it("detects plain number when no currency", () => {
    expect(sniffKind(["1200", "50.5", "-3"]).kind).toBe("number");
  });

  it("detects ISO date", () => {
    expect(sniffKind(["2026-05-01", "2026-05-02", "2026-05-03"]).kind).toBe(
      "date",
    );
  });

  it("detects boolean", () => {
    expect(sniffKind(["yes", "no", "yes", "no"]).kind).toBe("boolean");
  });

  it("detects enum on low-cardinality strings (>=8 samples)", () => {
    // H-5: enum threshold raised from 4 to 8 samples to avoid
    // mis-classifying small name columns as enums.
    const guess = sniffKind([
      "morning",
      "evening",
      "morning",
      "evening",
      "morning",
      "evening",
      "morning",
      "evening",
    ]);
    expect(guess.kind).toBe("enum");
    expect(guess.enumValues).toEqual(
      expect.arrayContaining(["morning", "evening"]),
    );
  });

  it("does NOT detect enum under 8 samples (H-5)", () => {
    expect(
      sniffKind(["morning", "evening", "morning", "evening", "morning"]).kind,
    ).toBe("string");
  });

  it("falls back to string for high-cardinality text", () => {
    expect(
      sniffKind(["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"])
        .kind,
    ).toBe("string");
  });

  it("returns string on empty samples", () => {
    expect(sniffKind([]).kind).toBe("string");
  });

  it("H-5: pathological money input completes in <50ms (no ReDoS)", () => {
    const evil = "$" + ",1".repeat(100);
    const start = Date.now();
    sniffKind([evil, evil, evil, evil, evil, evil, evil, evil]);
    const elapsed = Date.now() - start;
    // The previous `[\d,]*` shape was quadratic; the tightened
    // `\d+(,\d{3})*` shape rejects in O(n). 50ms is generous slack.
    expect(elapsed).toBeLessThan(50);
  });
});

describe("snakeCase + humanLabel", () => {
  it("snake_cases varied headers", () => {
    expect(snakeCase("Shift Pattern")).toBe("shift_pattern");
    expect(snakeCase("Overtime Rate ($/hr)")).toBe("overtime_rate_hr");
    expect(snakeCase("transport-stipend")).toBe("transport_stipend");
  });

  it("rejects numeric-only headers", () => {
    expect(snakeCase("123")).toBe("");
  });

  it("caps at 64 chars", () => {
    const long = "a".repeat(200);
    expect(snakeCase(long).length).toBe(64);
  });

  it("humanLabel trims and de-underscores", () => {
    expect(humanLabel("shift_pattern")).toBe("shift pattern");
    expect(humanLabel("  Many   Spaces  ")).toBe("Many Spaces");
  });
});

describe("diffCsvAgainstSchema", () => {
  it("proposes new columns and confirms existing", () => {
    const csv = [
      "name,shift_pattern,transport_stipend",
      "Alice,morning,15000",
      "Bob,evening,12000",
      "Charlie,morning,15000",
      "Diana,evening,12000",
    ].join("\n");
    const result = diffCsvAgainstSchema({
      orgId: ORG,
      tableKey: "employees",
      csv,
      staticColumns: ["name"],
      liveFields: [],
      proposerId: "hr-csv-ingest",
      source: "employees-2026-05.csv",
    });
    expect(result.confirmedExisting).toEqual(["name"]);
    expect(result.proposals.length).toBe(2);
    const keys = result.proposals.map((p) => p.fieldKey).sort();
    expect(keys).toEqual(["shift_pattern", "transport_stipend"]);
  });

  it("skips columns already in the live registry", () => {
    const csv = "name,shift_pattern\nAlice,morning\nBob,evening\n";
    const result = diffCsvAgainstSchema({
      orgId: ORG,
      tableKey: "employees",
      csv,
      staticColumns: ["name"],
      liveFields: [liveField("shift_pattern")],
      proposerId: "hr-csv-ingest",
      source: "employees-2026-05.csv",
    });
    expect(result.proposals.length).toBe(0);
    expect(result.confirmedExisting).toEqual(
      expect.arrayContaining(["name", "shift_pattern"]),
    );
  });

  it("drops duplicate headers (same snake-cased key)", () => {
    const csv = "name,Shift Pattern,shift_pattern\nA,m,m2\n";
    const result = diffCsvAgainstSchema({
      orgId: ORG,
      tableKey: "employees",
      csv,
      staticColumns: ["name"],
      liveFields: [],
      proposerId: "hr-csv-ingest",
      source: "x.csv",
    });
    expect(result.dropped.length).toBeGreaterThan(0);
    const keys = result.proposals.map((p) => p.fieldKey);
    expect(keys.filter((k) => k === "shift_pattern").length).toBe(1);
  });

  it("respects maxProposals cap", () => {
    const headers = [
      "name",
      ...Array.from({ length: 30 }, (_, i) => `col_${i}`),
    ];
    const dataRow = headers.map(() => "x").join(",");
    const csv = `${headers.join(",")}\n${dataRow}\n${dataRow}\n`;
    const result = diffCsvAgainstSchema({
      orgId: ORG,
      tableKey: "employees",
      csv,
      staticColumns: ["name"],
      liveFields: [],
      proposerId: "hr-csv-ingest",
      source: "wide.csv",
      maxProposals: 5,
    });
    expect(result.proposals.length).toBe(5);
  });

  it("returns empty result on empty CSV", () => {
    const result = diffCsvAgainstSchema({
      orgId: ORG,
      tableKey: "employees",
      csv: "",
      staticColumns: [],
      liveFields: [],
      proposerId: "hr-csv-ingest",
      source: "empty.csv",
    });
    expect(result.proposals).toEqual([]);
    expect(result.confirmedExisting).toEqual([]);
  });

  it("includes sample values capped at 5, 400 chars each", () => {
    const longCell = "x".repeat(500);
    const csv =
      `name,description\n${["A", longCell].join(",")}\n` +
      Array.from({ length: 7 }, (_, i) => `B${i},${longCell}`).join("\n") +
      "\n";
    const result = diffCsvAgainstSchema({
      orgId: ORG,
      tableKey: "employees",
      csv,
      staticColumns: ["name"],
      liveFields: [],
      proposerId: "hr-csv-ingest",
      source: "x.csv",
    });
    const proposal = result.proposals[0];
    expect(proposal).toBeDefined();
    expect(proposal!.sampleValues!.length).toBeLessThanOrEqual(5);
    for (const v of proposal!.sampleValues!) {
      expect(v.length).toBeLessThanOrEqual(400);
    }
  });
});
