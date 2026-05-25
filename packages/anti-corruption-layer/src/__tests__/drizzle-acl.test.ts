import { describe, expect, it } from "vitest";
import {
  TenantDrizzleACL,
  type DrizzleTenantRow,
  type DomainTenant,
  type TenantId,
} from "../drizzle-acl.js";

const sampleRow: DrizzleTenantRow = {
  id: "t-1",
  display_name: "Acme Estates",
  country_code: "TZ",
  created_at: new Date("2025-01-01T00:00:00Z"),
  deleted_at: null,
};

describe("TenantDrizzleACL", () => {
  it("maps snake_case row to camelCase domain", () => {
    const acl = new TenantDrizzleACL();
    const domain = acl.toDomain(sampleRow);
    expect(domain.id).toBe("t-1");
    expect(domain.displayName).toBe("Acme Estates");
    expect(domain.countryCode).toBe("TZ");
    expect(domain.isDeleted).toBe(false);
  });

  it("brands the id", () => {
    const acl = new TenantDrizzleACL();
    const domain = acl.toDomain(sampleRow);
    const _check: TenantId = domain.id;
    expect(_check).toBe("t-1");
  });

  it("flags isDeleted when deleted_at is non-null", () => {
    const acl = new TenantDrizzleACL();
    const domain = acl.toDomain({
      ...sampleRow,
      deleted_at: new Date(),
    });
    expect(domain.isDeleted).toBe(true);
  });

  it("fromDomain maps camelCase back to snake_case", () => {
    const acl = new TenantDrizzleACL();
    const domain: DomainTenant = {
      id: "t-2" as TenantId,
      displayName: "Roof Tiles Inc",
      countryCode: "KE",
      createdAt: new Date("2024-12-01T00:00:00Z"),
      isDeleted: false,
    };
    const row = acl.fromDomain(domain);
    expect(row.id).toBe("t-2");
    expect(row.display_name).toBe("Roof Tiles Inc");
    expect(row.country_code).toBe("KE");
    expect(row.deleted_at).toBeNull();
  });

  it("fromDomain sets deleted_at when isDeleted=true", () => {
    const acl = new TenantDrizzleACL();
    const row = acl.fromDomain({
      id: "t-3" as TenantId,
      displayName: "x",
      countryCode: "NG",
      createdAt: new Date(),
      isDeleted: true,
    });
    expect(row.deleted_at).not.toBeNull();
  });

  it("caches when cacheSize > 0", () => {
    const acl = new TenantDrizzleACL({ cacheSize: 5 });
    acl.toDomain(sampleRow);
    acl.toDomain(sampleRow);
    expect(acl.cacheEntries()).toBe(1);
  });
});
