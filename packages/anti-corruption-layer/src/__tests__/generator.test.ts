import { describe, expect, it } from "vitest";
import { generateACL } from "../generator.js";

describe("generateACL", () => {
  it("produces a compilable-looking subclass", () => {
    const src = generateACL({
      className: "LeaseACL",
      domainType: "Lease",
      externalType: "LeaseRow",
      mappings: [
        { domainField: "id", externalField: "id" },
        { domainField: "rentAmount", externalField: "rent_amount" },
      ],
    });
    expect(src).toContain("class LeaseACL extends BaseACL<Lease, LeaseRow>");
    expect(src).toContain("id: external.id,");
    expect(src).toContain("rentAmount: external.rent_amount,");
    expect(src).toContain("id: domain.id,");
    expect(src).toContain("rent_amount: domain.rentAmount,");
  });

  it("supports custom toDomainExpr", () => {
    const src = generateACL({
      className: "X",
      domainType: "D",
      externalType: "E",
      mappings: [
        {
          domainField: "createdAt",
          externalField: "created_at",
          toDomainExpr: "new Date(external.created_at)",
        },
      ],
    });
    expect(src).toContain("createdAt: new Date(external.created_at),");
  });

  it("supports custom fromDomainExpr", () => {
    const src = generateACL({
      className: "X",
      domainType: "D",
      externalType: "E",
      mappings: [
        {
          domainField: "ttlMs",
          externalField: "ttl_seconds",
          fromDomainExpr: "Math.floor(domain.ttlMs / 1000)",
        },
      ],
    });
    expect(src).toContain("ttl_seconds: Math.floor(domain.ttlMs / 1000),");
  });

  it("imports BaseACL from this package", () => {
    const src = generateACL({
      className: "X",
      domainType: "D",
      externalType: "E",
      mappings: [],
    });
    expect(src).toContain('@borjie/anti-corruption-layer');
  });
});
