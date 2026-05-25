import { describe, expect, it } from "vitest";
import {
  MPesaSTKPushACL,
  type MpesaStkPushResponse,
} from "../mpesa-acl.js";

const successResp: MpesaStkPushResponse = {
  MerchantRequestID: "MR-001",
  CheckoutRequestID: "CR-002",
  ResponseCode: "0",
  ResponseDescription: "Success",
  CustomerMessage: "Please enter your M-Pesa PIN",
};

const failResp: MpesaStkPushResponse = {
  MerchantRequestID: "MR-003",
  CheckoutRequestID: "CR-004",
  ResponseCode: "1037",
  ResponseDescription: "DS timeout user not reached",
  CustomerMessage: "",
};

describe("MPesaSTKPushACL", () => {
  it("maps ResponseCode=0 → payment.initiated", () => {
    const acl = new MPesaSTKPushACL();
    const event = acl.toDomain(successResp);
    expect(event.type).toBe("payment.initiated");
    if (event.type === "payment.initiated") {
      expect(event.merchantRequestId).toBe("MR-001");
      expect(event.checkoutRequestId).toBe("CR-002");
      expect(event.customerMessage).toBe("Please enter your M-Pesa PIN");
    }
  });

  it("maps non-zero ResponseCode → payment.rejected", () => {
    const acl = new MPesaSTKPushACL();
    const event = acl.toDomain(failResp);
    expect(event.type).toBe("payment.rejected");
    if (event.type === "payment.rejected") {
      expect(event.rejectionCode).toBe("1037");
      expect(event.rejectionReason).toBe("DS timeout user not reached");
    }
  });

  it("fromDomain (payment.initiated) round-trips success shape", () => {
    const acl = new MPesaSTKPushACL();
    const event = acl.toDomain(successResp);
    const back = acl.fromDomain(event);
    expect(back.ResponseCode).toBe("0");
    expect(back.MerchantRequestID).toBe(successResp.MerchantRequestID);
  });

  it("fromDomain (payment.rejected) sets ResponseCode to rejection code", () => {
    const acl = new MPesaSTKPushACL();
    const event = acl.toDomain(failResp);
    const back = acl.fromDomain(event);
    expect(back.ResponseCode).toBe("1037");
  });

  it("Vendor-shape strings never leak into domain", () => {
    const acl = new MPesaSTKPushACL();
    const event = acl.toDomain(successResp);
    // No PascalCase keys.
    for (const k of Object.keys(event)) {
      expect(k[0]).toBe(k[0]?.toLowerCase());
    }
  });

  it("caches when cacheSize > 0", () => {
    const acl = new MPesaSTKPushACL({ cacheSize: 5 });
    acl.toDomain(successResp);
    acl.toDomain(successResp);
    expect(acl.cacheEntries()).toBe(1);
  });
});
