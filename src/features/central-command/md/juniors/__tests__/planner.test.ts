/**
 * Tests — MD junior planner. Verifies that proposeJuniorSpawn picks
 * the right junior across the common operator phrasings + that it
 * returns null when nothing matches.
 */

import { describe, expect, it } from "vitest";

import { defaultJuniorRegistry } from "../index";
import { proposeJuniorSpawn } from "../planner";

const SAMPLE_CSV = ["name,role", "Alice,Eng", "Bob,Designer"].join("\n");

describe("proposeJuniorSpawn", () => {
  it("returns null when there is no CSV + no attachment + no hint", () => {
    expect(
      proposeJuniorSpawn(
        { text: "tell me about employees" },
        defaultJuniorRegistry,
      ),
    ).toBeNull();
  });

  it("returns null when CSV is present but text/file give no domain hint", () => {
    expect(
      proposeJuniorSpawn(
        { text: "here is some data", csv: "a,b\n1,2\n" },
        defaultJuniorRegistry,
      ),
    ).toBeNull();
  });

  it("picks hr-csv-ingest from employee phrasing + CSV", () => {
    const p = proposeJuniorSpawn(
      {
        text: "Please ingest these new employees",
        csv: SAMPLE_CSV,
      },
      defaultJuniorRegistry,
    );
    expect(p).not.toBeNull();
    expect(p!.junior.id).toBe("hr-csv-ingest");
    expect(p!.tableKey).toBe("employees");
    expect(p!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("picks suppliers junior from vendor phrasing + CSV attachment", () => {
    const p = proposeJuniorSpawn(
      {
        text: "load the new vendor list",
        attachment: { filename: "vendors.csv", mimeType: "text/csv" },
        csv: SAMPLE_CSV,
      },
      defaultJuniorRegistry,
    );
    expect(p).not.toBeNull();
    expect(p!.tableKey).toBe("suppliers");
  });

  it("explicit tableKeyHint dominates", () => {
    const p = proposeJuniorSpawn(
      {
        text: "ingest these employees", // says employees…
        tableKeyHint: "inventory", // …but explicit hint says inventory
        csv: SAMPLE_CSV,
      },
      defaultJuniorRegistry,
    );
    expect(p!.tableKey).toBe("inventory");
    expect(p!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("filename fallback picks the right tableKey when text is empty", () => {
    const p = proposeJuniorSpawn(
      {
        text: "",
        attachment: { filename: "inventory-2026-05.csv", mimeType: "text/csv" },
        csv: SAMPLE_CSV,
      },
      defaultJuniorRegistry,
    );
    expect(p!.tableKey).toBe("inventory");
  });

  it("'every' inside chat text is not parsed as 'employee' (whole-word match)", () => {
    const p = proposeJuniorSpawn(
      {
        text: "check every PR for the inventory tab",
        csv: SAMPLE_CSV,
      },
      defaultJuniorRegistry,
    );
    expect(p!.tableKey).toBe("inventory");
  });

  it("confidence stays in (0.4, 0.95]", () => {
    for (let i = 0; i < 5; i += 1) {
      const p = proposeJuniorSpawn(
        {
          text: "ingest these new customer accounts",
          csv: SAMPLE_CSV,
        },
        defaultJuniorRegistry,
      );
      expect(p!.confidence).toBeGreaterThan(0.4);
      expect(p!.confidence).toBeLessThanOrEqual(0.95);
    }
  });
});
