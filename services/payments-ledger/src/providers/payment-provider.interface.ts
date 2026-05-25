/**
 * Payment Provider Interface
 * Defines the contract for pluggable payment providers (Stripe, M-PESA, etc.)
 */
import {
  Money,
  PaymentIntentId,
  TenantId,
  CustomerId,
  CurrencyCode
} from '@borjie/domain-models';
import type { PaymentStatus } from '../types';

/**
 * Result of creating a payment intent with the provider
 */
export interface CreatePaymentResult {
  externalId: string;
  status: PaymentStatus;
  clientSecret?: string;      // For client-side confirmation (Stripe)
  redirectUrl?: string;       // For redirect-based flows
  qrCode?: string;            // For QR code based payments
  instructions?: string;      // Human-readable instructions
  expiresAt?: Date;
}

/**
 * Result of capturing/confirming a payment
 */
export interface CapturePaymentResult {
  externalId: string;
  status: PaymentStatus;
  receiptUrl?: string;
  paidAt?: Date;
  failureReason?: string;
  failureCode?: string;
}

/**
 * Result of refunding a payment
 */
export interface RefundResult {
  refundId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  amount: Money;
  failureReason?: string;
}

/**
 * Result of creating a transfer/payout
 */
export interface TransferResult {
  transferId: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'PAID' | 'FAILED' | 'CANCELLED';
  amount: Money;
  arrivalDate?: Date;
  failureReason?: string;
}

/**
 * Webhook event from payment provider
 */
export interface ProviderWebhookEvent {
  id: string;
  type: string;
  provider: string;
  data: Record<string, unknown>;
  timestamp: Date;
  signature?: string;
}

/**
 * Customer representation at provider
 */
export interface ProviderCustomer {
  externalId: string;
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}

/**
 * Payment method at provider
 */
export interface ProviderPaymentMethod {
  externalId: string;
  type: 'card' | 'bank_account' | 'mobile_money';
  last4?: string;
  brand?: string;
  expiresAt?: Date;
  isDefault: boolean;
}

/**
 * Connected account (for marketplace/platform model)
 */
export interface ConnectedAccount {
  externalId: string;
  status: 'PENDING' | 'ACTIVE' | 'RESTRICTED' | 'DISABLED';
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  requirementsCurrentlyDue: string[];
}

/**
 * Payment Provider Interface
 * All payment providers must implement this interface
 */
export interface IPaymentProvider {
  /**
   * Provider identifier
   */
  readonly name: string;

  /**
   * Supported currencies
   */
  readonly supportedCurrencies: CurrencyCode[];

  /**
   * Check if provider supports a currency
   */
  supportsCurrency(currency: CurrencyCode): boolean;

  /**
   * Create a customer at the provider
   */
  createCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    email: string,
    name?: string,
    metadata?: Record<string, string>
  ): Promise<ProviderCustomer>;

  /**
   * Get customer from provider
   */
  getCustomer(externalCustomerId: string): Promise<ProviderCustomer | null>;

  /**
   * Create a payment intent
   */
  createPaymentIntent(params: {
    amount: Money;
    customerId: string;          // Provider's customer ID
    paymentMethodId?: string;    // Provider's payment method ID
    description?: string;
    statementDescriptor?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
    // Platform/Connect options
    applicationFeeAmount?: Money;
    transferDestination?: string; // Connected account ID
  }): Promise<CreatePaymentResult>;

  /**
   * Confirm/capture a payment intent
   */
  confirmPaymentIntent(
    externalId: string,
    paymentMethodId?: string
  ): Promise<CapturePaymentResult>;

  /**
   * Cancel a payment intent
   */
  cancelPaymentIntent(
    externalId: string,
    reason?: string
  ): Promise<void>;

  /**
   * Get payment intent status
   */
  getPaymentIntentStatus(
    externalId: string
  ): Promise<{ status: PaymentStatus; metadata?: Record<string, unknown> }>;

  /**
   * Refund a payment
   */
  refundPayment(params: {
    paymentIntentExternalId: string;
    amount?: Money;  // Partial refund if specified
    reason?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundResult>;

  /**
   * Create a transfer/payout to connected account or bank
   */
  createTransfer(params: {
    amount: Money;
    destination: string;  // Bank account or connected account ID
    description?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<TransferResult>;

  /**
   * Get transfer status
   */
  getTransferStatus(transferId: string): Promise<TransferResult>;

  /**
   * Attach a payment method to customer
   */
  attachPaymentMethod(
    paymentMethodId: string,
    customerId: string
  ): Promise<ProviderPaymentMethod>;

  /**
   * Detach a payment method from customer
   */
  detachPaymentMethod(paymentMethodId: string): Promise<void>;

  /**
   * List customer's payment methods
   */
  listPaymentMethods(customerId: string): Promise<ProviderPaymentMethod[]>;

  /**
   * Set default payment method for customer
   */
  setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<void>;

  /**
   * Create connected account (for owners receiving payouts)
   */
  createConnectedAccount(params: {
    email: string;
    country: string;
    businessType?: 'individual' | 'company';
    metadata?: Record<string, string>;
  }): Promise<ConnectedAccount>;

  /**
   * Get connected account status
   */
  getConnectedAccount(accountId: string): Promise<ConnectedAccount | null>;

  /**
   * Create account onboarding link
   */
  createAccountLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string>;

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): boolean;

  /**
   * Parse webhook event
   */
  parseWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): ProviderWebhookEvent;

  /**
   * Get settlement/balance information
   */
  getBalance(): Promise<{
    available: Money[];
    pending: Money[];
  }>;
}

/**
 * Base class for payment providers with common functionality
 */
export abstract class BasePaymentProvider implements IPaymentProvider {
  abstract readonly name: string;
  abstract readonly supportedCurrencies: CurrencyCode[];

  supportsCurrency(currency: CurrencyCode): boolean {
    return this.supportedCurrencies.includes(currency);
  }

  abstract createCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    email: string,
    name?: string,
    metadata?: Record<string, string>
  ): Promise<ProviderCustomer>;

  abstract getCustomer(externalCustomerId: string): Promise<ProviderCustomer | null>;

  abstract createPaymentIntent(params: {
    amount: Money;
    customerId: string;
    paymentMethodId?: string;
    description?: string;
    statementDescriptor?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
    applicationFeeAmount?: Money;
    transferDestination?: string;
  }): Promise<CreatePaymentResult>;

  abstract confirmPaymentIntent(
    externalId: string,
    paymentMethodId?: string
  ): Promise<CapturePaymentResult>;

  abstract cancelPaymentIntent(
    externalId: string,
    reason?: string
  ): Promise<void>;

  abstract getPaymentIntentStatus(
    externalId: string
  ): Promise<{ status: PaymentStatus; metadata?: Record<string, unknown> }>;

  abstract refundPayment(params: {
    paymentIntentExternalId: string;
    amount?: Money;
    reason?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundResult>;

  abstract createTransfer(params: {
    amount: Money;
    destination: string;
    description?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<TransferResult>;

  abstract getTransferStatus(transferId: string): Promise<TransferResult>;

  abstract attachPaymentMethod(
    paymentMethodId: string,
    customerId: string
  ): Promise<ProviderPaymentMethod>;

  abstract detachPaymentMethod(paymentMethodId: string): Promise<void>;

  abstract listPaymentMethods(customerId: string): Promise<ProviderPaymentMethod[]>;

  abstract setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<void>;

  abstract createConnectedAccount(params: {
    email: string;
    country: string;
    businessType?: 'individual' | 'company';
    metadata?: Record<string, string>;
  }): Promise<ConnectedAccount>;

  abstract getConnectedAccount(accountId: string): Promise<ConnectedAccount | null>;

  abstract createAccountLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string>;

  abstract verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): boolean;

  abstract parseWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): ProviderWebhookEvent;

  abstract getBalance(): Promise<{
    available: Money[];
    pending: Money[];
  }>;
}
