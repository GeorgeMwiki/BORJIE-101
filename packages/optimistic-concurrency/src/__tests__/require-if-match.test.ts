import { describe, expect, it } from "vitest";
import { etag } from "../etag.js";
import { requireIfMatch } from "../require-if-match.js";

interface MockContext {
  req: { header(name: string): string | undefined };
  set(key: string, value: unknown): void;
  json(body: unknown, status: number): { body: unknown; status: number };
}

function makeCtx(
  headers: Record<string, string>
): MockContext & { stored: Record<string, unknown> } {
  const stored: Record<string, unknown> = {};
  return {
    req: {
      header: (name: string) =>
        headers[name] ?? headers[name.toLowerCase()],
    },
    set: (key: string, value: unknown) => {
      stored[key] = value;
    },
    json: (body: unknown, status: number) => ({ body, status }),
    stored,
  };
}

describe("requireIfMatch", () => {
  it("returns 428 when If-Match is missing", async () => {
    const lease = { id: "l1", rent: 100 };
    const mw = requireIfMatch({ getCurrentResource: async () => lease });
    const ctx = makeCtx({});
    const result = (await mw(ctx, async () => {})) as
      | { body: unknown; status: number }
      | undefined;
    expect(result?.status).toBe(428);
  });

  it("returns 404 when resource is null", async () => {
    const mw = requireIfMatch({ getCurrentResource: async () => null });
    const ctx = makeCtx({ "If-Match": "*" });
    const result = (await mw(ctx, async () => {})) as
      | { body: unknown; status: number }
      | undefined;
    expect(result?.status).toBe(404);
  });

  it("returns 412 when ETag mismatches", async () => {
    const lease = { id: "l1", rent: 100 };
    const mw = requireIfMatch({ getCurrentResource: async () => lease });
    const ctx = makeCtx({ "If-Match": 'W/"stale"' });
    const result = (await mw(ctx, async () => {})) as
      | { body: unknown; status: number }
      | undefined;
    expect(result?.status).toBe(412);
  });

  it("calls next() on match and sets etagMatched flag", async () => {
    const lease = { id: "l1", rent: 100 };
    const mw = requireIfMatch({ getCurrentResource: async () => lease });
    const ctx = makeCtx({ "If-Match": etag(lease) });
    let called = false;
    await mw(ctx, async () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(ctx.stored.etagMatched).toBe(true);
  });

  it("accepts * as If-Match wildcard", async () => {
    const lease = { id: "l1", rent: 100 };
    const mw = requireIfMatch({ getCurrentResource: async () => lease });
    const ctx = makeCtx({ "If-Match": "*" });
    let called = false;
    await mw(ctx, async () => {
      called = true;
    });
    expect(called).toBe(true);
  });
});
