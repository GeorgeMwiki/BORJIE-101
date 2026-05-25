import { describe, expect, it } from "vitest";
import { deepStripPii, stripPii } from "../redaction.js";

describe("stripPii", () => {
  it("redacts email addresses", () => {
    const { stripped, piiFound } = stripPii("contact me at jane@example.com today");
    expect(stripped).toBe("contact me at [REDACTED] today");
    expect(piiFound).toBe(true);
  });

  it("redacts E.164 phone numbers", () => {
    const r = stripPii("call +1 555-123-4567 now");
    expect(r.stripped).toBe("call [REDACTED] now");
  });

  it("redacts TZ local phone numbers", () => {
    const r = stripPii("ring 0712345678 please");
    expect(r.stripped).toBe("ring [REDACTED] please");
  });

  it("redacts NIDA-style identifiers", () => {
    const r = stripPii("Tenant NIDA: 19900101-12345-12345-12 verified");
    expect(r.stripped).toMatch(/\[REDACTED\]/);
  });

  it("returns piiFound=false on clean text", () => {
    const r = stripPii("All cats are mortal");
    expect(r.piiFound).toBe(false);
    expect(r.stripped).toBe("All cats are mortal");
  });

  it("handles empty string", () => {
    const r = stripPii("");
    expect(r.stripped).toBe("");
    expect(r.piiFound).toBe(false);
  });

  it("redacts multiple matches in one string", () => {
    const r = stripPii("alice@x.com and bob@y.com");
    expect(r.stripped).toBe("[REDACTED] and [REDACTED]");
  });
});

describe("deepStripPii", () => {
  it("strips strings inside an object", () => {
    const v = { name: "John", email: "x@y.com" };
    const r = deepStripPii(v) as { value: { email: string }; piiFound: boolean };
    expect(r.value.email).toBe("[REDACTED]");
    expect(r.piiFound).toBe(true);
  });

  it("strips arrays of strings", () => {
    const v = ["a", "x@y.com"];
    const r = deepStripPii(v) as { value: string[]; piiFound: boolean };
    expect(r.value[1]).toBe("[REDACTED]");
  });

  it("preserves numbers and booleans untouched", () => {
    const v = { age: 42, active: true };
    const r = deepStripPii(v) as { value: Record<string, unknown> };
    expect(r.value).toEqual({ age: 42, active: true });
  });

  it("walks nested structures", () => {
    const v = {
      tenant: { contact: { email: "a@b.com" } },
      tags: ["clean", "danger@evil.com"],
    };
    const r = deepStripPii(v) as {
      value: { tenant: { contact: { email: string } }; tags: string[] };
    };
    expect(r.value.tenant.contact.email).toBe("[REDACTED]");
    expect(r.value.tags[1]).toBe("[REDACTED]");
  });
});
