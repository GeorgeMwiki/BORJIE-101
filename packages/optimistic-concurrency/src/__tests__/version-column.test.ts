import { describe, expect, it } from "vitest";
import { withVersionColumn } from "../version-column.js";
import { VersionConflictExhaustedError } from "../errors.js";

interface Row {
  readonly id: string;
  readonly rent: number;
  readonly version: number;
}

describe("withVersionColumn", () => {
  it("succeeds on first attempt", async () => {
    let written: Row | null = null;
    const result = await withVersionColumn<Row, Row>({
      read: async () => ({ id: "l1", rent: 100, version: 1 }),
      mutate: async (r) => ({ ...r, rent: 150 }),
      attemptWrite: async (next, _expected) => {
        written = next;
        return { success: true, result: next };
      },
      delayMs: () => 0,
    });
    expect(result.rent).toBe(150);
    expect((written as Row | null)?.version).toBe(2);
  });

  it("retries on version conflict then succeeds", async () => {
    let calls = 0;
    const result = await withVersionColumn<Row, Row>({
      read: async () => ({ id: "l1", rent: 100, version: calls }),
      mutate: async (r) => ({ ...r, rent: 150 }),
      attemptWrite: async (next) => {
        calls += 1;
        if (calls < 2) return { success: false };
        return { success: true, result: next };
      },
      delayMs: () => 0,
    });
    expect(result.rent).toBe(150);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("throws VersionConflictExhaustedError after maxAttempts", async () => {
    await expect(
      withVersionColumn<Row, Row>({
        read: async () => ({ id: "l1", rent: 100, version: 1 }),
        mutate: async (r) => ({ ...r, rent: 150 }),
        attemptWrite: async () => ({ success: false }),
        maxAttempts: 2,
        delayMs: () => 0,
      })
    ).rejects.toBeInstanceOf(VersionConflictExhaustedError);
  });

  it("throws if read returns null mid-retry", async () => {
    await expect(
      withVersionColumn<Row, Row>({
        read: async () => null,
        mutate: async (r) => r,
        attemptWrite: async () => ({ success: false }),
        delayMs: () => 0,
      })
    ).rejects.toBeInstanceOf(VersionConflictExhaustedError);
  });

  it("bumps version exactly by 1 on each attempt", async () => {
    let written: Row | null = null;
    await withVersionColumn<Row, Row>({
      read: async () => ({ id: "l1", rent: 100, version: 5 }),
      mutate: async (r) => ({ ...r, rent: r.rent + 1 }),
      attemptWrite: async (next) => {
        written = next;
        return { success: true, result: next };
      },
      delayMs: () => 0,
    });
    expect((written as Row | null)?.version).toBe(6);
  });

  it("passes expectedVersion=current.version to attemptWrite", async () => {
    let expected = -1;
    await withVersionColumn<Row, Row>({
      read: async () => ({ id: "l1", rent: 100, version: 42 }),
      mutate: async (r) => r,
      attemptWrite: async (next, exp) => {
        expected = exp;
        return { success: true, result: next };
      },
      delayMs: () => 0,
    });
    expect(expected).toBe(42);
  });
});
