/**
 * Auto-Populate — Entity Type tests.
 *
 * These are real validation tests against the Zod schemas.
 * No mocks anywhere — pure data → pure assertion.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_ENTITY_KINDS,
  ENTITY_KIND_TO_TABLE,
  canonicaliseName,
  customerSchema,
  employeeSchema,
  extractedEntitySchema,
} from "../entity-types";

describe("canonicaliseName", () => {
  it("lower-cases and strips punctuation", () => {
    expect(canonicaliseName("Acme Corp.")).toBe("acme");
    expect(canonicaliseName("ACME-CORP!")).toBe("acme");
  });

  it("strips corporate suffixes", () => {
    expect(canonicaliseName("Globex Inc")).toBe("globex");
    expect(canonicaliseName("Initech Ltd")).toBe("initech");
    expect(canonicaliseName("Hooli Corporation")).toBe("hooli");
    expect(canonicaliseName("Pied Piper LLC")).toBe("pied piper");
  });

  it("collapses whitespace", () => {
    expect(canonicaliseName("   Acme   Corp   ")).toBe("acme");
  });

  it("keeps short names unchanged when only suffix-like", () => {
    // "Co" is a corporate suffix but only one token: don't strip to empty.
    expect(canonicaliseName("Co")).toBe("co");
  });
});

describe("ALL_ENTITY_KINDS + table map", () => {
  it("has 11 entity kinds", () => {
    expect(ALL_ENTITY_KINDS).toHaveLength(11);
  });

  it("maps every kind to a table", () => {
    for (const kind of ALL_ENTITY_KINDS) {
      expect(ENTITY_KIND_TO_TABLE[kind]).toBeTruthy();
    }
  });
});

describe("entity schema validation", () => {
  it("accepts a minimal valid customer", () => {
    const data = {
      kind: "customer",
      canonicalName: "acme",
      displayName: "Acme Corp",
      confidence: 0.9,
      sourceSpan: { start: 0, end: 9, text: "Acme Corp" },
    };
    const parsed = customerSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it("rejects a customer with confidence > 1", () => {
    const bad = {
      kind: "customer",
      canonicalName: "acme",
      displayName: "Acme",
      confidence: 1.5,
      sourceSpan: { start: 0, end: 4, text: "Acme" },
    };
    expect(customerSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an employee with invalid email", () => {
    const bad = {
      kind: "employee",
      canonicalName: "sarah",
      displayName: "Sarah Chen",
      confidence: 0.8,
      sourceSpan: { start: 0, end: 10, text: "Sarah Chen" },
      email: "not-an-email",
    };
    expect(employeeSchema.safeParse(bad).success).toBe(false);
  });

  it("discriminated union routes by kind", () => {
    const data = {
      kind: "product",
      canonicalName: "x 200",
      displayName: "X-200",
      confidence: 0.95,
      sourceSpan: { start: 0, end: 5, text: "X-200" },
      isTopSeller: true,
    };
    const parsed = extractedEntitySchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe("product");
    }
  });

  it("rejects unknown kind", () => {
    const bad = {
      kind: "alien",
      canonicalName: "foo",
      displayName: "Foo",
      confidence: 0.5,
      sourceSpan: { start: 0, end: 3, text: "Foo" },
    };
    expect(extractedEntitySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects strict-mode extra unknown fields", () => {
    const bad = {
      kind: "customer",
      canonicalName: "acme",
      displayName: "Acme",
      confidence: 0.9,
      sourceSpan: { start: 0, end: 4, text: "Acme" },
      randomField: "nope",
    };
    expect(customerSchema.safeParse(bad).success).toBe(false);
  });
});
