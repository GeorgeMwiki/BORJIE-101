/**
 * Payment Orchestration Service
 * Coordinates payment processing across multiple providers
 */
import { v4 as uuidv4 } from 'uuid';
import {
  Money,
  PaymentIntent,
  PaymentIntentAggregate,
  PaymentIntentId,
  PaymentIntentType,
  TenantId,
  CustomerId,
  LeaseId,
  CurrencyCode
} from '@borjie/domain-models';
import type { PaymentStatus } from '../types';
import { TenantAggregate, createId, calculatePlatformFee } from '../domain-extensions';
import {
  IPaymentProvider,
  CreatePaymentResult
} from '../providers/payment-provider.interface';
import { IPaymentIntentRepository } from '../repositories/payment-intent.repository';
import { IEventPublisher, createEvent } from '../events/event-publisher';
import {
  PaymentIntentCreatedEvent,
  PaymentProcessingStartedEvent,
  PaymentSucceededEvent,
  PaymentFailedEvent,
  PaymentRefundedEvent
} from '../events/payment-events';
import { omitUndefined } from '../lib/omit-undefined';

/**
 * Logger interface
 */
export interface ILogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Create payment request
 */
export interface CreatePaymentRequest {
  tenantId: TenantId;
  customerId: CustomerId;
  leaseId?: LeaseId;
  type: PaymentIntentType;
  amount: Money;
  description: string;
  paymentMethodId?: string;
  statementDescriptor?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Payment result
 */
export interface PaymentResult {
  paymentIntentId: PaymentIntentId;
  status: PaymentStatus;
  clientSecret?: string;
  redirectUrl?: string;
  instructions?: string;
  receiptUrl?: string;
}

/**
 * Refund request
 */
export interface RefundRequest {
  paymentIntentId: PaymentIntentId;
  tenantId: TenantId;
  amount?: Money;  // Partial refund if specified
  reason?: string;
  idempotencyKey?: string;
}

/**
 * Refund result
 */
export interface PaymentRefundResult {
  refundId: string;
  paymentIntentId: PaymentIntentId;
  amount: Money;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface PaymentOrchestrationServiceDeps {
  paymentIntentRepository: IPaymentIntentRepository;
  eventPublisher: IEventPublisher;
  logger: ILogger;
}

/**
 * Payment Orchestration Service
 * Handles payment lifecycle with pluggable providers
 */
export class PaymentOrchestrationService {
  private providers: Map<string, IPaymentProvider> = new Map();
  private defaultProvider: string | null = null;
  private currencyProviders: Map<CurrencyCode, string> = new Map();

  private repository: IPaymentIntentRepository;
  private eventPublisher: IEventPublisher;
  private logger: ILogger;

  constructor(deps: PaymentOrchestrationServiceDeps) {
    this.repository = deps.paymentIntentRepository;
    this.eventPublisher = deps.eventPublisher;
    this.logger = deps.logger;
  }

  /**
   * Register a payment provider
   */
  registerProvider(
    provider: IPaymentProvider,
    options?: { isDefault?: boolean; currencies?: CurrencyCode[] }
  ): void {
    this.providers.set(provider.name, provider);
    
    if (options?.isDefault) {
      this.defaultProvider = provider.name;
    }

    // Map currencies to this provider
    const currencies = options?.currencies || provider.supportedCurrencies;
    for (const currency of currencies) {
      if (!this.currencyProviders.has(currency)) {
        this.currencyProviders.set(currency, provider.name);
      }
    }

    this.logger.info(`Registered payment provider: ${provider.name}`, {
      currencies: currencies,
      isDefault: options?.isDefault
    });
  }

  /**
   * Get provider for a currency
   */
  private getProvider(currency: CurrencyCode): IPaymentProvider {
    const providerName = this.currencyProviders.get(currency) || this.defaultProvider;
    if (!providerName) {
      throw new Error(`No payment provider configured for currency ${currency}`);
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Payment provider ${providerName} not found`);
    }

    return provider;
  }

  /**
   * Create a payment intent
   */
  async createPayment(
    request: CreatePaymentRequest,
    tenant: TenantAggregate
  ): Promise<PaymentResult> {
    const idempotencyKey = request.idempotencyKey || uuidv4();

    // Check for existing payment with same idempotency key
    const existing = await this.repository.findByIdempotencyKey(
      idempotencyKey,
      request.tenantId
    );
    if (existing) {
      this.logger.info('Returning existing payment for idempotency key', {
        paymentIntentId: existing.id,
        idempotencyKey
      });
      return {
        paymentIntentId: existing.id,
        status: existing.status
      };
    }

    // Calculate platform fee
    const platformFeePercent = tenant.getPlatformFeePercent();
    const platformFee = calculatePlatformFee(request.amount, platformFeePercent);
    const netAmount = request.amount.subtract(platformFee);

    // Create payment intent
    const paymentIntentId = createId<PaymentIntentId>(`pi_${uuidv4()}`);
    const now = new Date();

    const paymentIntent: PaymentIntent = omitUndefined({
      id: paymentIntentId,
      tenantId: request.tenantId,
      customerId: request.customerId,
      leaseId: request.leaseId,
      type: request.type,
      status: 'PENDING' as const,
      amount: request.amount,
      platformFee,
      netAmount,
      description: request.description,
      idempotencyKey,
      statementDescriptor: request.statementDescriptor,
      metadata: request.metadata,
      createdAt: now,
      createdBy: 'system',
      updatedAt: now,
      updatedBy: 'system'
    }) as PaymentIntent;

    // Save to repository
    await this.repository.create(paymentIntent);

    // Publish event
    await this.eventPublisher.publish(
      createEvent<PaymentIntentCreatedEvent>(
        'PAYMENT_INTENT_CREATED',
        'PaymentIntent',
        paymentIntentId,
        request.tenantId,
        omitUndefined({
          customerId: request.customerId,
          leaseId: request.leaseId,
          amount: request.amount.toData(),
          type: request.type,
          description: request.description
        }) as PaymentIntentCreatedEvent['payload']
      )
    );

    this.logger.info('Payment intent created', {
      paymentIntentId,
      tenantId: request.tenantId,
      amount: request.amount.toString()
    });

    // If payment method provided, process immediately
    if (request.paymentMethodId) {
      return this.processPayment(
        paymentIntentId,
        request.tenantId,
        request.paymentMethodId,
        tenant
      );
    }

    return {
      paymentIntentId,
      status: 'PENDING'
    };
  }

  /**
   * Process a payment with a payment method
   */
  async processPayment(
    paymentIntentId: PaymentIntentId,
    tenantId: TenantId,
    paymentMethodId: string,
    tenant: TenantAggregate
  ): Promise<PaymentResult> {
    const paymentIntent = await this.repository.findById(paymentIntentId, tenantId);
    if (!paymentIntent) {
      throw new Error(`Payment intent ${paymentIntentId} not found`);
    }

    const aggregate = new PaymentIntentAggregate(paymentIntent);
    const provider = this.getProvider(paymentIntent.amount.currency);

    try {
      // Create payment with provider
      const result = await provider.createPaymentIntent(omitUndefined({
        amount: paymentIntent.amount,
        customerId: paymentMethodId, // Would need mapping in real impl
        paymentMethodId,
        description: paymentIntent.description,
        statementDescriptor: paymentIntent.statementDescriptor,
        metadata: {
          tenantId: paymentIntent.tenantId,
          paymentIntentId: paymentIntent.id,
          ...paymentIntent.metadata as Record<string, string>
        },
        idempotencyKey: paymentIntent.idempotencyKey,
        applicationFeeAmount: paymentIntent.platformFee,
        transferDestination: tenant.paymentSettings.stripeAccountId
      }) as Parameters<typeof provider.createPaymentIntent>[0]);

      // Update payment intent with provider details
      aggregate.markProcessing(result.externalId, provider.name);
      await this.repository.update(aggregate.toData());

      // Publish event
      await this.eventPublisher.publish(
        createEvent<PaymentProcessingStartedEvent>(
          'PAYMENT_PROCESSING_STARTED',
          'PaymentIntent',
          paymentIntentId,
          tenantId,
          {
            externalId: result.externalId,
            providerName: provider.name
          }
        )
      );

      // If requires action, return client secret
      if (result.status === 'REQUIRES_ACTION') {
        aggregate.markRequiresAction('Customer action required');
        await this.repository.update(aggregate.toData());

        return omitUndefined({
          paymentIntentId,
          status: 'REQUIRES_ACTION' as const,
          clientSecret: result.clientSecret,
          redirectUrl: result.redirectUrl,
          instructions: result.instructions
        }) as PaymentResult;
      }

      // If succeeded immediately
      if (result.status === 'SUCCEEDED') {
        return this.handlePaymentSuccess(aggregate, tenantId);
      }

      return omitUndefined({
        paymentIntentId,
        status: result.status,
        clientSecret: result.clientSecret
      }) as PaymentResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      aggregate.markFailed(errorMessage);
      await this.repository.update(aggregate.toData());

      await this.eventPublisher.publish(
        createEvent<PaymentFailedEvent>(
          'PAYMENT_FAILED',
          'PaymentIntent',
          paymentIntentId,
          tenantId,
          {
            customerId: paymentIntent.customerId,
            failureReason: errorMessage
          }
        )
      );

      this.logger.error('Payment processing failed', {
        paymentIntentId,
        error: errorMessage
      });

      throw error;
    }
  }

  /**
   * Handle payment success (called by webhook handler)
   */
  async handlePaymentSuccess(
    aggregate: PaymentIntentAggregate,
    tenantId: TenantId,
    receiptUrl?: string
  ): Promise<PaymentResult> {
    aggregate.markSucceeded(receiptUrl);
    const paymentIntent = aggregate.toData();
    await this.repository.update(paymentIntent);

    await this.eventPublisher.publish(
      createEvent<PaymentSucceededEvent>(
        'PAYMENT_SUCCEEDED',
        'PaymentIntent',
        paymentIntent.id,
        tenantId,
        omitUndefined({
          customerId: paymentIntent.customerId,
          leaseId: paymentIntent.leaseId,
          amount: paymentIntent.amount.toData(),
          platformFee: paymentIntent.platformFee?.toData(),
          netAmount: paymentIntent.netAmount?.toData(),
          paidAt: paymentIntent.paidAt!,
          receiptUrl
        }) as PaymentSucceededEvent['payload']
      )
    );

    this.logger.info('Payment succeeded', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount.toString()
    });

    return omitUndefined({
      paymentIntentId: paymentIntent.id,
      status: 'SUCCEEDED' as const,
      receiptUrl
    }) as PaymentResult;
  }

  /**
   * Handle webhook from payment provider.
   *
   * W4-A: `tenantId` is REQUIRED. The router (`server.ts`) resolves it from
   * the verified provider payload (Stripe `metadata.tenantId`, M-Pesa
   * shortcode map) BEFORE calling this method, so the tenant-scoped
   * `findByExternalId` can guarantee cross-tenant isolation per
   * migration 0169.
   */
  async handleWebhook(
    providerName: string,
    externalId: string,
    status: PaymentStatus,
    tenantId: TenantId,
    receiptUrl?: string,
    failureReason?: string
  ): Promise<void> {
    const paymentIntent = await this.repository.findByExternalId(
      externalId,
      providerName,
      tenantId
    );
    if (!paymentIntent) {
      this.logger.warn('Payment intent not found for webhook', {
        externalId,
        providerName,
        tenantId
      });
      return;
    }

    const aggregate = new PaymentIntentAggregate(paymentIntent);

    switch (status) {
      case 'SUCCEEDED':
        await this.handlePaymentSuccess(aggregate, paymentIntent.tenantId, receiptUrl);
        break;
      case 'FAILED':
        aggregate.markFailed(failureReason || 'Payment failed');
        await this.repository.update(aggregate.toData());
        await this.eventPublisher.publish(
          createEvent<PaymentFailedEvent>(
            'PAYMENT_FAILED',
            'PaymentIntent',
            paymentIntent.id,
            paymentIntent.tenantId,
            {
              customerId: paymentIntent.customerId,
              failureReason: failureReason || 'Payment failed'
            }
          )
        );
        break;
      case 'CANCELLED':
        aggregate.cancel(failureReason || 'Payment cancelled');
        await this.repository.update(aggregate.toData());
        break;
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(request: RefundRequest): Promise<PaymentRefundResult> {
    const paymentIntent = await this.repository.findById(
      request.paymentIntentId,
      request.tenantId
    );
    if (!paymentIntent) {
      throw new Error(`Payment intent ${request.paymentIntentId} not found`);
    }

    const aggregate = new PaymentIntentAggregate(paymentIntent);
    if (!aggregate.canRefund()) {
      throw new Error(`Payment ${request.paymentIntentId} cannot be refunded`);
    }

    const refundAmount = request.amount || aggregate.getRefundableAmount();
    if (refundAmount.isGreaterThan(aggregate.getRefundableAmount())) {
      throw new Error('Refund amount exceeds refundable amount');
    }

    const provider = this.getProvider(paymentIntent.amount.currency);
    const idempotencyKey = request.idempotencyKey || uuidv4();

    const result = await provider.refundPayment(omitUndefined({
      paymentIntentExternalId: paymentIntent.externalId!,
      amount: request.amount,
      reason: request.reason,
      idempotencyKey
    }) as Parameters<typeof provider.refundPayment>[0]);

    if (result.status === 'SUCCEEDED') {
      aggregate.recordRefund(refundAmount);
      await this.repository.update(aggregate.toData());

      await this.eventPublisher.publish(
        createEvent<PaymentRefundedEvent>(
          'PAYMENT_REFUNDED',
          'PaymentIntent',
          paymentIntent.id,
          request.tenantId,
          {
            customerId: paymentIntent.customerId,
            refundAmount: refundAmount.toData(),
            totalRefunded: (aggregate.toData().refundedAmount || refundAmount).toData(),
            isFullRefund: aggregate.toData().status === 'REFUNDED'
          }
        )
      );
    }

    return {
      refundId: result.refundId,
      paymentIntentId: request.paymentIntentId,
      amount: refundAmount,
      status: result.status
    };
  }

  /**
   * Get payment intent
   */
  async getPaymentIntent(
    paymentIntentId: PaymentIntentId,
    tenantId: TenantId
  ): Promise<PaymentIntent | null> {
    return this.repository.findById(paymentIntentId, tenantId);
  }

  /**
   * Get pending payments for customer
   */
  async getPendingPayments(
    tenantId: TenantId,
    customerId: CustomerId
  ): Promise<PaymentIntent[]> {
    return this.repository.findPendingByCustomer(tenantId, customerId);
  }
}
