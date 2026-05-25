/**
 * Payment-specific error types
 */
export class PaymentError extends Error {
  readonly code: string;
  readonly provider?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    code: string,
    provider?: string,
    cause?: unknown
  ) {
    super(message);
    this.code = code;
    this.provider = provider;
    this.cause = cause;
    this.name = 'PaymentError';
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
}

export class ProviderAuthError extends PaymentError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, 'PROVIDER_AUTH_ERROR', provider, cause);
    this.name = 'ProviderAuthError';
  }
}

export class ValidationError extends PaymentError {
  constructor(message: string, provider?: string) {
    super(message, 'VALIDATION_ERROR', provider);
    this.name = 'ValidationError';
  }
}

export class CallbackError extends PaymentError {
  constructor(message: string, provider?: string, cause?: unknown) {
    super(message, 'CALLBACK_ERROR', provider, cause);
    this.name = 'CallbackError';
  }
}
