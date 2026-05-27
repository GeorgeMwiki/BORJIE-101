/**
 * Typed errors for the buyer-marketplace-advisor.
 *
 * All errors carry a stable `code` for cross-process matching and a
 * human-readable `message`. Optional `details` capture safe-to-log
 * context (no PII, no secrets).
 */

export type BuyerAdvisorErrorCode =
  | 'UNKNOWN_BUYER'
  | 'KYC_BLOCKED'
  | 'ROUTE_UNAVAILABLE'
  | 'INVALID_INPUT';

export class BuyerAdvisorError extends Error {
  readonly code: BuyerAdvisorErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: BuyerAdvisorErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'BuyerAdvisorError';
    this.code = code;
    this.details = details;
  }
}

export class UnknownBuyerError extends BuyerAdvisorError {
  constructor(buyerId: string, tenantId: string) {
    super('UNKNOWN_BUYER', `Unknown buyer ${buyerId} in tenant ${tenantId}`, {
      buyerId,
      tenantId,
    });
    this.name = 'UnknownBuyerError';
  }
}

export class KycBlockedError extends BuyerAdvisorError {
  constructor(buyerId: string, reason: string) {
    super('KYC_BLOCKED', `KYC blocked for buyer ${buyerId}: ${reason}`, {
      buyerId,
      reason,
    });
    this.name = 'KycBlockedError';
  }
}

export class RouteUnavailableError extends BuyerAdvisorError {
  constructor(originMineId: string, destPort: string, reason: string) {
    super(
      'ROUTE_UNAVAILABLE',
      `No viable route from ${originMineId} to ${destPort}: ${reason}`,
      { originMineId, destPort, reason },
    );
    this.name = 'RouteUnavailableError';
  }
}
