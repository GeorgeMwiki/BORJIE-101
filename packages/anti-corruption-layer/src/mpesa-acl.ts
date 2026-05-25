/**
 * Worked example #2 — M-Pesa STK Push response → domain event.
 *
 * Vendor shape (Daraja API) — verbose, capitalised, every field a
 * string. Domain wants a clean discriminated-union event so the
 * payment-ledger projector can pattern-match. The ACL absorbs the
 * vendor's idiosyncrasies (e.g. `0` is success, ResponseCode is
 * stringly-typed, MerchantRequestID is the idempotency anchor).
 *
 * `fromDomain` is rarely used for inbound webhooks (we don't write
 * back to Daraja in this shape) but supplied for completeness — round-
 * trip + tests.
 */

import { BaseACL, type BaseACLOptions } from "./base-acl.js";

/** Daraja STK Push response (subset — what we actually consume). */
export interface MpesaStkPushResponse {
  readonly MerchantRequestID: string;
  readonly CheckoutRequestID: string;
  readonly ResponseCode: string;
  readonly ResponseDescription: string;
  readonly CustomerMessage: string;
}

/** Discriminated domain event. */
export type PaymentInitiatedDomainEvent =
  | {
      readonly type: "payment.initiated";
      readonly merchantRequestId: string;
      readonly checkoutRequestId: string;
      readonly customerMessage: string;
    }
  | {
      readonly type: "payment.rejected";
      readonly merchantRequestId: string;
      readonly rejectionCode: string;
      readonly rejectionReason: string;
    };

export class MPesaSTKPushACL extends BaseACL<
  PaymentInitiatedDomainEvent,
  MpesaStkPushResponse
> {
  constructor(opts: BaseACLOptions = {}) {
    super(opts);
  }

  protected override mapToDomain(
    external: MpesaStkPushResponse
  ): PaymentInitiatedDomainEvent {
    // Daraja: ResponseCode "0" = success; anything else = rejected.
    if (external.ResponseCode === "0") {
      return {
        type: "payment.initiated",
        merchantRequestId: external.MerchantRequestID,
        checkoutRequestId: external.CheckoutRequestID,
        customerMessage: external.CustomerMessage,
      };
    }
    return {
      type: "payment.rejected",
      merchantRequestId: external.MerchantRequestID,
      rejectionCode: external.ResponseCode,
      rejectionReason: external.ResponseDescription,
    };
  }

  protected override mapFromDomain(
    domain: PaymentInitiatedDomainEvent
  ): MpesaStkPushResponse {
    if (domain.type === "payment.initiated") {
      return {
        MerchantRequestID: domain.merchantRequestId,
        CheckoutRequestID: domain.checkoutRequestId,
        ResponseCode: "0",
        ResponseDescription: "Success",
        CustomerMessage: domain.customerMessage,
      };
    }
    return {
      MerchantRequestID: domain.merchantRequestId,
      CheckoutRequestID: "",
      ResponseCode: domain.rejectionCode,
      ResponseDescription: domain.rejectionReason,
      CustomerMessage: "",
    };
  }
}
