import { describe, expect, it } from "vitest";
import {
  CONSERVATIVE_LANDLORD_SYSTEM,
  DEFAULT_PROPERTY_STATUTE_CLAUSES,
  PRAGMATIC_PM_SYSTEM,
  PRO_TENANT_SYSTEM,
} from "../voices.js";

describe("system prompts — pinned voice identity", () => {
  it("Conservative Owner names its role and anchors", () => {
    expect(CONSERVATIVE_LANDLORD_SYSTEM).toMatch(/CONSERVATIVE OWNER/);
    expect(CONSERVATIVE_LANDLORD_SYSTEM).toMatch(/royalty \/ payment owed/);
    expect(CONSERVATIVE_LANDLORD_SYSTEM).toMatch(/offtake covenant/);
  });

  it("Pro-Counterparty names its role and enforces fair-dealing test", () => {
    expect(PRO_TENANT_SYSTEM).toMatch(/PRO-COUNTERPARTY/);
    expect(PRO_TENANT_SYSTEM).toMatch(/fair-dealing|anti-discrim/i);
    expect(PRO_TENANT_SYSTEM).toMatch(/substituting/);
  });

  it("Pragmatic Ops names its role and forces address of counterparty concerns", () => {
    expect(PRAGMATIC_PM_SYSTEM).toMatch(/PRAGMATIC OPERATIONS MANAGER/);
    expect(PRAGMATIC_PM_SYSTEM).toMatch(/MUST address/);
    expect(PRAGMATIC_PM_SYSTEM).toMatch(/Do NOT rubber-stamp/);
  });

  it("each voice instructs 4-8 sentences", () => {
    expect(CONSERVATIVE_LANDLORD_SYSTEM).toMatch(/4-8 sentences/);
    expect(PRO_TENANT_SYSTEM).toMatch(/4-8 sentences/);
  });
});

describe("default statute clauses", () => {
  it("includes notice period, habitability, non-discrimination, deposit, retaliation", () => {
    const ids = DEFAULT_PROPERTY_STATUTE_CLAUSES.map((c) => c.id);
    expect(ids).toContain("S-01-NOTICE-PERIOD");
    expect(ids).toContain("S-02-HABITABILITY");
    expect(ids).toContain("S-03-NON-DISCRIMINATION");
    expect(ids).toContain("S-04-DEPOSIT-RETURN");
    expect(ids).toContain("S-05-RETALIATION");
  });

  it("each clause has a non-trivial description", () => {
    for (const c of DEFAULT_PROPERTY_STATUTE_CLAUSES) {
      expect(c.description.length).toBeGreaterThan(20);
    }
  });

  it("is frozen so callers cannot mutate the shared default", () => {
    expect(Object.isFrozen(DEFAULT_PROPERTY_STATUTE_CLAUSES)).toBe(true);
  });
});
