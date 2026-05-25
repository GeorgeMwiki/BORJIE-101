import { describe, expect, it } from "vitest";
import { etag } from "../etag.js";
import {
  withETagPrecondition,
  withETagPreconditionOrThrow,
} from "../etag-precondition.js";
import { StaleResourceError } from "../errors.js";

interface Lease {
  readonly id: string;
  readonly rent: number;
}

describe("withETagPrecondition", () => {
  it("returns ok when ETag matches", async () => {
    const lease: Lease = { id: "l1", rent: 100 };
    const out = await withETagPrecondition<Lease, Lease>({
      getResource: async () => lease,
      currentETag: etag(lease),
      mutate: async (l) => ({
        next: { ...l, rent: 150 },
        result: { ...l, rent: 150 },
      }),
    });
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.result.rent).toBe(150);
      expect(out.newETag).not.toBe(etag(lease));
    }
  });

  it("returns stale when ETag mismatches", async () => {
    const lease: Lease = { id: "l1", rent: 100 };
    const out = await withETagPrecondition<Lease, Lease>({
      getResource: async () => lease,
      currentETag: 'W/"stale123"',
      mutate: async (l) => ({ next: l, result: l }),
    });
    expect(out.status).toBe("stale");
  });

  it("returns stale when resource was deleted", async () => {
    const out = await withETagPrecondition<Lease, Lease>({
      getResource: async () => null,
      currentETag: 'W/"any"',
      mutate: async (l) => ({ next: l, result: l }),
    });
    expect(out.status).toBe("stale");
  });

  it("* matches anything", async () => {
    const lease: Lease = { id: "l1", rent: 100 };
    const out = await withETagPrecondition<Lease, Lease>({
      getResource: async () => lease,
      currentETag: "*",
      mutate: async (l) => ({ next: l, result: l }),
    });
    expect(out.status).toBe("ok");
  });
});

describe("withETagPreconditionOrThrow", () => {
  it("returns result on match", async () => {
    const lease: Lease = { id: "l1", rent: 100 };
    const out = await withETagPreconditionOrThrow<Lease, number>({
      getResource: async () => lease,
      currentETag: etag(lease),
      mutate: async () => ({
        next: { ...lease, rent: 200 },
        result: 200,
      }),
    });
    expect(out.result).toBe(200);
  });

  it("throws StaleResourceError on mismatch", async () => {
    const lease: Lease = { id: "l1", rent: 100 };
    await expect(
      withETagPreconditionOrThrow<Lease, Lease>({
        getResource: async () => lease,
        currentETag: 'W/"bad"',
        mutate: async (l) => ({ next: l, result: l }),
      })
    ).rejects.toBeInstanceOf(StaleResourceError);
  });
});
