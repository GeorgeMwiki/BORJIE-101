/**
 * Stripe Payment Provider Implementation
 * Implements the payment provider interface for Stripe
 */
import Stripe from 'stripe';
import {
  Money,
  TenantId,
  CustomerId,
  CurrencyCode
} from '@borjie/domain-models';
import type { PaymentStatus } from '../types';
import {
  BasePaymentProvider,
  CreatePaymentResult,
  CapturePaymentResult,
  RefundResult,
  TransferResult,
  ProviderCustomer,
  ProviderPaymentMethod,
  ProviderWebhookEvent,
  ConnectedAccount
} from './payment-provider.interface';

/**
 * Map Stripe status to our PaymentStatus
 */
function mapStripeStatus(stripeStatus: Stripe.PaymentIntent.Status): PaymentStatus {
  switch (stripeStatus) {
    case 'requires_payment_method':
    case 'requires_confirmation':
      return 'PENDING';
    case 'requires_action':
      return 'REQUIRES_ACTION';
    case 'processing':
      return 'PROCESSING';
    case 'succeeded':
      return 'SUCCEEDED';
    case 'canceled':
      return 'CANCELLED';
    default:
      return 'FAILED';
  }
}

export interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  apiVersion?: Stripe.LatestApiVersion;
}

export class StripePaymentProvider extends BasePaymentProvider {
  readonly name = 'stripe';
  readonly supportedCurrencies: CurrencyCode[] = [
    'USD', 'EUR', 'GBP', 'KES', 'TZS', 'UGX'
  ];

  private stripe: Stripe;
  private webhookSecret: string;

  constructor(config: StripeProviderConfig) {
    super();
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: config.apiVersion || '2026-03-25.dahlia'
    });
    this.webhookSecret = config.webhookSecret;
  }

  async createCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    email: string,
    name?: string,
    metadata?: Record<string, string>
  ): Promise<ProviderCustomer> {
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        tenantId,
        customerId,
        ...metadata
      }
    });

    return {
      externalId: customer.id,
      email: customer.email ?? undefined,
      name: customer.name ?? undefined,
      metadata: customer.metadata as Record<string, string>
    };
  }

  async getCustomer(externalCustomerId: string): Promise<ProviderCustomer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(externalCustomerId);
      if (customer.deleted) {
        return null;
      }
      return {
        externalId: customer.id,
        email: customer.email ?? undefined,
        name: customer.name ?? undefined,
        metadata: customer.metadata as Record<string, string>
      };
    } catch (error) {
      if ((error as { readonly code?: string }).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async createPaymentIntent(params: {
    amount: Money;
    customerId: string;
    paymentMethodId?: string;
    description?: string;
    statementDescriptor?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
    applicationFeeAmount?: Money;
    transferDestination?: string;
  }): Promise<CreatePaymentResult> {
    const createParams: Stripe.PaymentIntentCreateParams = {
      amount: params.amount.amountMinorUnits,
      currency: params.amount.currency.toLowerCase(),
      customer: params.customerId,
      payment_method: params.paymentMethodId,
      description: params.description,
      statement_descriptor: params.statementDescriptor?.substring(0, 22),
      metadata: params.metadata,
      confirm: !!params.paymentMethodId,
      automatic_payment_methods: params.paymentMethodId 
        ? undefined 
        : { enabled: true }
    };

    // Add Connect parameters for platform model
    if (params.applicationFeeAmount && params.transferDestination) {
      createParams.application_fee_amount = params.applicationFeeAmount.amountMinorUnits;
      createParams.transfer_data = {
        destination: params.transferDestination
      };
    }

    const paymentIntent = await this.stripe.paymentIntents.create(
      createParams,
      { idempotencyKey: params.idempotencyKey }
    );

    return {
      externalId: paymentIntent.id,
      status: mapStripeStatus(paymentIntent.status),
      clientSecret: paymentIntent.client_secret ?? undefined
    };
  }

  async confirmPaymentIntent(
    externalId: string,
    paymentMethodId?: string
  ): Promise<CapturePaymentResult> {
    const paymentIntent = await this.stripe.paymentIntents.confirm(externalId, {
      payment_method: paymentMethodId
    });

    return {
      externalId: paymentIntent.id,
      status: mapStripeStatus(paymentIntent.status),
      receiptUrl: paymentIntent.latest_charge 
        ? (typeof paymentIntent.latest_charge === 'string'
            ? undefined
            : paymentIntent.latest_charge.receipt_url ?? undefined)
        : undefined,
      paidAt: paymentIntent.status === 'succeeded' 
        ? new Date(paymentIntent.created * 1000)
        : undefined
    };
  }

  async cancelPaymentIntent(externalId: string, reason?: string): Promise<void> {
    await this.stripe.paymentIntents.cancel(externalId, {
      cancellation_reason: reason as Stripe.PaymentIntentCancelParams.CancellationReason
    });
  }

  async getPaymentIntentStatus(
    externalId: string
  ): Promise<{ status: PaymentStatus; metadata?: Record<string, unknown> }> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(externalId);
    return {
      status: mapStripeStatus(paymentIntent.status),
      metadata: paymentIntent.metadata as Record<string, unknown>
    };
  }

  async refundPayment(params: {
    paymentIntentExternalId: string;
    amount?: Money;
    reason?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: params.paymentIntentExternalId,
        amount: params.amount?.amountMinorUnits,
        reason: params.reason as Stripe.RefundCreateParams.Reason,
        metadata: params.metadata
      },
      { idempotencyKey: params.idempotencyKey }
    );

    return {
      refundId: refund.id,
      status: refund.status === 'succeeded' ? 'SUCCEEDED' : 
              refund.status === 'pending' ? 'PENDING' : 'FAILED',
      amount: Money.fromMinorUnits(
        refund.amount,
        refund.currency.toUpperCase() as CurrencyCode
      ),
      failureReason: refund.failure_reason ?? undefined
    };
  }

  async createTransfer(params: {
    amount: Money;
    destination: string;
    description?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<TransferResult> {
    const transfer = await this.stripe.transfers.create(
      {
        amount: params.amount.amountMinorUnits,
        currency: params.amount.currency.toLowerCase(),
        destination: params.destination,
        description: params.description,
        metadata: params.metadata
      },
      { idempotencyKey: params.idempotencyKey }
    );

    return {
      transferId: transfer.id,
      status: 'PAID',
      amount: Money.fromMinorUnits(
        transfer.amount,
        transfer.currency.toUpperCase() as CurrencyCode
      )
    };
  }

  async getTransferStatus(transferId: string): Promise<TransferResult> {
    const transfer = await this.stripe.transfers.retrieve(transferId);
    
    return {
      transferId: transfer.id,
      status: transfer.reversed ? 'CANCELLED' : 'PAID',
      amount: Money.fromMinorUnits(
        transfer.amount,
        transfer.currency.toUpperCase() as CurrencyCode
      )
    };
  }

  async attachPaymentMethod(
    paymentMethodId: string,
    customerId: string
  ): Promise<ProviderPaymentMethod> {
    const paymentMethod = await this.stripe.paymentMethods.attach(
      paymentMethodId,
      { customer: customerId }
    );

    return this.mapPaymentMethod(paymentMethod);
  }

  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async listPaymentMethods(customerId: string): Promise<ProviderPaymentMethod[]> {
    const methods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card'
    });

    return methods.data.map(pm => this.mapPaymentMethod(pm));
  }

  async setDefaultPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<void> {
    await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });
  }

  async createConnectedAccount(params: {
    email: string;
    country: string;
    businessType?: 'individual' | 'company';
    metadata?: Record<string, string>;
  }): Promise<ConnectedAccount> {
    const account = await this.stripe.accounts.create({
      type: 'express',
      email: params.email,
      country: params.country,
      business_type: params.businessType,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      },
      metadata: params.metadata
    });

    return this.mapConnectedAccount(account);
  }

  async getConnectedAccount(accountId: string): Promise<ConnectedAccount | null> {
    try {
      const account = await this.stripe.accounts.retrieve(accountId);
      return this.mapConnectedAccount(account);
    } catch (error) {
      if ((error as { readonly code?: string }).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async createAccountLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    const accountLink = await this.stripe.accountLinks.create({
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: 'account_onboarding'
    });

    return accountLink.url;
  }

  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): boolean {
    try {
      this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      return true;
    } catch {
      return false;
    }
  }

  parseWebhookEvent(
    payload: string | Buffer,
    signature: string,
    webhookSecret: string
  ): ProviderWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret
    );

    return {
      id: event.id,
      type: event.type,
      provider: this.name,
      data: event.data.object as unknown as Record<string, unknown>,
      timestamp: new Date(event.created * 1000),
      signature
    };
  }

  async getBalance(): Promise<{ available: Money[]; pending: Money[] }> {
    const balance = await this.stripe.balance.retrieve();

    return {
      available: balance.available.map(b => 
        Money.fromMinorUnits(b.amount, b.currency.toUpperCase() as CurrencyCode)
      ),
      pending: balance.pending.map(b => 
        Money.fromMinorUnits(b.amount, b.currency.toUpperCase() as CurrencyCode)
      )
    };
  }

  private mapPaymentMethod(pm: Stripe.PaymentMethod): ProviderPaymentMethod {
    return {
      externalId: pm.id,
      type: pm.type === 'card' ? 'card' : 
            pm.type === 'us_bank_account' ? 'bank_account' : 'card',
      last4: pm.card?.last4,
      brand: pm.card?.brand,
      expiresAt: pm.card 
        ? new Date(pm.card.exp_year, pm.card.exp_month - 1)
        : undefined,
      isDefault: false
    };
  }

  private mapConnectedAccount(account: Stripe.Account): ConnectedAccount {
    const requirements = account.requirements?.currently_due || [];
    
    return {
      externalId: account.id,
      status: !account.details_submitted ? 'PENDING' :
              account.payouts_enabled ? 'ACTIVE' :
              requirements.length > 0 ? 'RESTRICTED' : 'DISABLED',
      payoutsEnabled: account.payouts_enabled ?? false,
      chargesEnabled: account.charges_enabled ?? false,
      requirementsCurrentlyDue: requirements
    };
  }
}
