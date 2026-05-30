/**
 * Auto-Populate — Service orchestration tests.
 *
 * These exercise the full processChat() pipeline with dryRun = true so
 * no DB calls fire. We inject a deterministic extractor + a known-entity
 * list to drive end-to-end behaviour from a single chat turn fixture.
 */

import { describe, it, expect } from "vitest";
import { processChat } from "../auto-populate-service";
import type { ExtractedEntity } from "../entity-types";
import type { KnownEntity } from "../dedupe";
import type { ExtractorInput } from "../extractor";

function mkExtractor(entities: ExtractedEntity[]) {
  return async (_input: ExtractorInput) => ({
    entities,
    rawResponse: "fixture",
    parseError: null as string | null,
  });
}

describe("processChat — end-to-end fixture flow", () => {
  it("auto-persists high-confidence entities", async () => {
    const text = "We just signed Acme Corp for $50k ARR.";
    const entities: ExtractedEntity[] = [
      {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme Corp",
        confidence: 0.95,
        sourceSpan: { start: 15, end: 24, text: "Acme Corp" },
        arrUsd: 50000,
        status: "active",
      },
    ];

    const result = await processChat("turn-1", text, {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor(entities),
      knownOverride: [] as KnownEntity[],
    });

    expect(result.entities).toHaveLength(1);
    expect(result.autoPersisted).toHaveLength(1);
    expect(result.confirmNeeded).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
    expect(result.autoPersisted[0]!.entity.kind).toBe("customer");
  });

  it("routes mid-confidence entities to confirm_needed", async () => {
    const text = "Maybe Bob will join us next month.";
    const entities: ExtractedEntity[] = [
      {
        kind: "employee",
        canonicalName: "bob",
        displayName: "Bob",
        confidence: 0.5,
        sourceSpan: { start: 6, end: 9, text: "Bob" },
        isNewHire: true,
      },
    ];

    const result = await processChat("turn-2", text, {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor(entities),
      knownOverride: [],
    });

    expect(result.autoPersisted).toHaveLength(0);
    expect(result.confirmNeeded).toHaveLength(1);
    expect(result.confirmNeeded[0]!.prompt).toContain("Bob");
  });

  it("drops low-confidence entities entirely", async () => {
    const text = "Random rambling about something.";
    const entities: ExtractedEntity[] = [
      {
        kind: "goal",
        canonicalName: "vague",
        displayName: "Vague Goal",
        confidence: 0.15,
        sourceSpan: { start: 0, end: 5, text: "Vague" },
      },
    ];

    const result = await processChat("turn-3", text, {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor(entities),
      knownOverride: [],
    });

    expect(result.autoPersisted).toHaveLength(0);
    expect(result.confirmNeeded).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });

  it("merges against known entities (canonical match)", async () => {
    const text = "Update for Acme.";
    const entities: ExtractedEntity[] = [
      {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme",
        confidence: 0.9,
        sourceSpan: { start: 11, end: 15, text: "Acme" },
      },
    ];
    const known: KnownEntity[] = [
      {
        id: "existing-1",
        tenantId: "tenant-A",
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme Corp",
      },
    ];

    const result = await processChat("turn-4", text, {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor(entities),
      knownOverride: known,
    });

    expect(result.autoPersisted).toHaveLength(1);
    expect(result.autoPersisted[0]!.merged).toBe(true);
  });

  it("returns empty result when the turn text is empty", async () => {
    const result = await processChat("turn-5", "", {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor([]),
      knownOverride: [],
    });
    expect(result.entities).toHaveLength(0);
    expect(result.autoPersisted).toHaveLength(0);
  });

  it("returns empty result for an invalid context", async () => {
    const result = await processChat("turn-6", "hello", {
      // Missing tenantId / userId.
      dryRun: true,
    } as unknown);
    expect(result.entities).toHaveLength(0);
  });

  it("partitions a mixed batch across all three gates", async () => {
    const text =
      "We signed Acme Corp for $50k. Maybe Bob will join. Vague idea somewhere.";
    const entities: ExtractedEntity[] = [
      {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme Corp",
        confidence: 0.95,
        sourceSpan: { start: 10, end: 19, text: "Acme Corp" },
      },
      {
        kind: "employee",
        canonicalName: "bob",
        displayName: "Bob",
        confidence: 0.5,
        sourceSpan: { start: 36, end: 39, text: "Bob" },
      },
      {
        kind: "goal",
        canonicalName: "vague",
        displayName: "Vague",
        confidence: 0.15,
        sourceSpan: { start: 53, end: 58, text: "Vague" },
      },
    ];

    const result = await processChat("turn-7", text, {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor(entities),
      knownOverride: [],
    });

    expect(result.autoPersisted).toHaveLength(1);
    expect(result.confirmNeeded).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });

  it("collapses intra-turn duplicates before persisting", async () => {
    const text = "Acme Corp signed. Acme is now active.";
    const entities: ExtractedEntity[] = [
      {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme Corp",
        confidence: 0.85,
        sourceSpan: { start: 0, end: 9, text: "Acme Corp" },
      },
      {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme",
        confidence: 0.95,
        sourceSpan: { start: 18, end: 22, text: "Acme" },
      },
    ];

    const result = await processChat("turn-8", text, {
      tenantId: "tenant-A",
      userId: "user-A",
      dryRun: true,
      extractorOverride: mkExtractor(entities),
      knownOverride: [],
    });

    // Should collapse into one entity (the higher-confidence one).
    expect(result.entities).toHaveLength(1);
    expect(result.autoPersisted).toHaveLength(1);
    expect(result.autoPersisted[0]!.entity.confidence).toBe(0.95);
  });
});

describe("audit-trail row projection", () => {
  it("produces a consistent row shape from input", async () => {
    // Lightweight smoke test that imports the pure helper, exercising the
    // public surface and giving the test the same audit-row guarantees the
    // service relies on.
    const mod = await import("../audit-trail");
    const row = mod.auditInputToRow({
      tenantId: "t-1",
      userId: "u-1",
      turnId: "turn-9",
      entity: {
        kind: "customer",
        canonicalName: "acme",
        displayName: "Acme Corp",
        confidence: 0.9,
        sourceSpan: { start: 0, end: 9, text: "Acme Corp" },
      },
      gateDecision: "auto_persist",
      dedupeAction: "insert",
      dedupeReason: "no existing rows of this kind",
      dedupeScore: 0,
      persistedRowId: "row-1",
      ownerConfirmation: "auto",
      errorMessage: null,
    });
    expect(row.tenant_id).toBe("t-1");
    expect(row.turn_id).toBe("turn-9");
    expect(row.entity_kind).toBe("customer");
    expect(row.persisted_table).toBe("ap_customers");
    expect(row.gate_decision).toBe("auto_persist");
  });
});
