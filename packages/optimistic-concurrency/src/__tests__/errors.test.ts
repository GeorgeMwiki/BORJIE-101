import { describe, expect, it } from "vitest";
import {
  StaleResourceError,
  VersionConflictExhaustedError,
} from "../errors.js";

describe("StaleResourceError", () => {
  it("carries code = STALE_RESOURCE", () => {
    const e = new StaleResourceError('W/"a"', 'W/"b"');
    expect(e.code).toBe("STALE_RESOURCE");
    expect(e.expectedETag).toBe('W/"a"');
    expect(e.actualETag).toBe('W/"b"');
    expect(e.name).toBe("StaleResourceError");
  });

  it("is instanceof Error", () => {
    expect(new StaleResourceError("a", "b")).toBeInstanceOf(Error);
  });
});

describe("VersionConflictExhaustedError", () => {
  it("carries code + attempts", () => {
    const e = new VersionConflictExhaustedError(5);
    expect(e.code).toBe("VERSION_CONFLICT_EXHAUSTED");
    expect(e.attempts).toBe(5);
  });
});
