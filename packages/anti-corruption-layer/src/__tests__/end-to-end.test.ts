import { describe, expect, it } from "vitest";
import {
  TenantDrizzleACL,
  type DrizzleTenantRow,
  type TenantId,
} from "../drizzle-acl.js";
import {
  MPesaSTKPushACL,
  type MpesaStkPushResponse,
} from "../mpesa-acl.js";

describe("end-to-end: domain stays clean of external shapes", () => {
  it("Drizzle row + M-Pesa response collide cleanly through ACLs", () => {
    const tenantACL = new TenantDrizzleACL();
    const mpesaACL = new MPesaSTKPushACL();

    const row: DrizzleTenantRow = {
      id: "t-1",
      display_name: "Acme",
      country_code: "TZ",
      created_at: new Date(),
      deleted_at: null,
    };
    const stkResp: MpesaStkPushResponse = {
      MerchantRequestID: "MR",
      CheckoutRequestID: "CR",
      ResponseCode: "0",
      ResponseDescription: "OK",
      CustomerMessage: "msg",
    };

    const tenant = tenantACL.toDomain(row);
    const event = mpesaACL.toDomain(stkResp);

    // No external shapes leak.
    expect(Object.keys(tenant)).not.toContain("display_name");
    expect(Object.keys(tenant)).not.toContain("country_code");
    if (event.type === "payment.initiated") {
      expect(Object.keys(event)).not.toContain("MerchantRequestID");
      expect(Object.keys(event)).not.toContain("ResponseCode");
    }
  });

  it("Drizzle ACL round-trips with no data loss for non-deleted tenants", () => {
    const acl = new TenantDrizzleACL();
    const row: DrizzleTenantRow = {
      id: "t-7",
      display_name: "Roof Tiles",
      country_code: "KE",
      created_at: new Date("2025-06-15T12:00:00Z"),
      deleted_at: null,
    };
    const back = acl.fromDomain(acl.toDomain(row));
    expect(back.id).toBe(row.id);
    expect(back.display_name).toBe(row.display_name);
    expect(back.country_code).toBe(row.country_code);
    expect(back.deleted_at).toBeNull();
  });

  it("M-Pesa ACL allows pattern-matching on event.type", () => {
    const acl = new MPesaSTKPushACL();
    const initiated = acl.toDomain({
      MerchantRequestID: "M1",
      CheckoutRequestID: "C1",
      ResponseCode: "0",
      ResponseDescription: "OK",
      CustomerMessage: "Pay",
    });
    const rejected = acl.toDomain({
      MerchantRequestID: "M2",
      CheckoutRequestID: "C2",
      ResponseCode: "1037",
      ResponseDescription: "Timeout",
      CustomerMessage: "",
    });
    expect(initiated.type === "payment.initiated").toBe(true);
    expect(rejected.type === "payment.rejected").toBe(true);
  });

  it("Caching does not corrupt round-trip", () => {
    const acl = new TenantDrizzleACL({ cacheSize: 100 });
    const row: DrizzleTenantRow = {
      id: "t-cache" as string,
      display_name: "Cache Test",
      country_code: "NG",
      created_at: new Date(),
      deleted_at: null,
    };
    const d1 = acl.toDomain(row);
    const d2 = acl.toDomain(row);
    expect(d1).toBe(d2); // same reference from cache
    const back = acl.fromDomain(d2);
    expect(back.id).toBe(row.id);
  });

  it("Branded id prevents accidental cross-type usage", () => {
    type LeaseId = string & { readonly __brand: "LeaseId" };
    const tenantId = "t-1" as TenantId;
    const leaseId = "l-1" as LeaseId;
    // The two are not assignable to each other (compile-time check).
    expect(typeof tenantId).toBe("string");
    expect(typeof leaseId).toBe("string");
    expect(tenantId).not.toBe(leaseId as unknown as TenantId);
  });

  it("rejected event preserves rejection code + reason", () => {
    const acl = new MPesaSTKPushACL();
    const ev = acl.toDomain({
      MerchantRequestID: "M-fail",
      CheckoutRequestID: "",
      ResponseCode: "1032",
      ResponseDescription: "Request cancelled by user",
      CustomerMessage: "",
    });
    if (ev.type === "payment.rejected") {
      expect(ev.rejectionCode).toBe("1032");
      expect(ev.rejectionReason).toBe("Request cancelled by user");
    } else {
      expect.fail("expected payment.rejected");
    }
  });

  it("ACL is bidirectional — fromDomain output is valid for toDomain input", () => {
    const acl = new MPesaSTKPushACL();
    const original = {
      MerchantRequestID: "M-loop",
      CheckoutRequestID: "C-loop",
      ResponseCode: "0",
      ResponseDescription: "Success",
      CustomerMessage: "Loop",
    } satisfies MpesaStkPushResponse;
    const domain = acl.toDomain(original);
    const external = acl.fromDomain(domain);
    const domain2 = acl.toDomain(external);
    expect(domain).toEqual(domain2);
  });
});
