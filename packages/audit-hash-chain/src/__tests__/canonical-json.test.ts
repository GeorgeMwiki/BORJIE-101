import { describe, expect, it } from "vitest";
import { canonicalJson } from "../canonical-json.js";

describe("canonicalJson", () => {
  it("emits primitives via JSON.stringify", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hello")).toBe('"hello"');
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
  });

  it("sorts object keys alphabetically", () => {
    const a = canonicalJson({ b: 1, a: 2, c: 3 });
    const b = canonicalJson({ a: 2, b: 1, c: 3 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("recursively sorts nested objects", () => {
    const v = { z: { b: 1, a: 2 }, a: { y: 1, x: 2 } };
    expect(canonicalJson(v)).toBe('{"a":{"x":2,"y":1},"z":{"a":2,"b":1}}');
  });

  it("emits empty objects and arrays", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  it("omits keys with undefined values to match JSON.stringify", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("handles nested arrays", () => {
    expect(canonicalJson([[1, 2], [3, 4]])).toBe("[[1,2],[3,4]]");
  });

  it("produces no whitespace", () => {
    const json = canonicalJson({ a: [1, 2, 3], b: { c: 4 } });
    expect(json).not.toMatch(/\s/);
  });

  it("escapes string contents like JSON.stringify", () => {
    expect(canonicalJson({ x: 'a "b" c' })).toBe('{"x":"a \\"b\\" c"}');
  });

  it("produces identical output for objects built in different orders", () => {
    const a: Record<string, number> = {};
    a["beta"] = 1;
    a["alpha"] = 2;
    const b: Record<string, number> = {};
    b["alpha"] = 2;
    b["beta"] = 1;
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("encodes NaN / Infinity as null (matches JSON.stringify)", () => {
    expect(canonicalJson(NaN)).toBe("null");
    expect(canonicalJson(Infinity)).toBe("null");
    expect(canonicalJson(-Infinity)).toBe("null");
  });
});
