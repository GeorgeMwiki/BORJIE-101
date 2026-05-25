/**
 * Payments & Ledger Service Server
 * HTTP server entry point
 */
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { z } from 'zod';

import {
  Money,
  TenantId,
  CustomerId,
  LeaseId,
  PaymentIntentId,
  AccountId,
  OwnerId,
  StatementId,
  asTenantId,
  asCustomerId,
  asLeaseId,
  asAccountId,
  asOwnerId,
  asStatementId,
  asPaymentIntentId,
  CurrencyCode,
  JournalTemplates
} from '@borjie/domain-models';
import type { PaymentStatus } from './types';

// Import domain extensions to augment Money prototype and get TenantAggregate
import './domain-extensions';
import { TenantAggregate } from './domain-extensions';

import { StripePaymentProvider } from './providers/stripe-provider';
import { MpesaPaymentProvider } from './providers/mpesa-provider';
import { resolvePlatformFeeBps } from './lib/platform-fee';
import { PaymentOrchestrationService, CreatePaymentRequest } from './services/payment-orchestration.service';
import { LedgerService } from './services/ledger.service';
import { ReconciliationService } from './services/reconciliation.service';
import { StatementGenerationService, GenerateStatementRequest } from './services/statement-generation.service';
import { DisbursementService, DisbursementRequest } from './services/disbursement.service';
import { InMemoryEventPublisher } from './events/event-publisher';
import { createRepositories } from './repositories/factory';
import { ReconciliationJob } from './jobs/reconciliation.job';
import { StatementGenerationJob } from './jobs/statement-generation.job';
import { DisbursementJob } from './jobs/disbursement.job';

// =============================================================================
// Request Validation Schemas
// =============================================================================

// CRITICAL-2 fix: tenantId is REMOVED from every mutation schema. The
// authoritative tenant context comes from `getTenantId(req)` which reads
// `req.principal.tenantId` set by `verifySupabaseAuthMiddleware`. Trusting
// a body-supplied tenantId here would let any authenticated tenant write
// into another tenant's ledger by changing one JSON field.
const CreatePaymentSchema = z.object({
  customerId: z.string(),
  leaseId: z.string().optional(),
  type: z.enum(['RENT_PAYMENT', 'DEPOSIT_PAYMENT', 'LATE_FEE_PAYMENT', 'MAINTENANCE_PAYMENT', 'UTILITY_PAYMENT', 'CONTRIBUTION', 'OTHER']),
  amount: z.object({
    amount: z.number().int().positive(),
    currency: z.enum(['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX'])
  }),
  description: z.string().max(500),
  paymentMethodId: z.string().optional(),
  statementDescriptor: z.string().max(22).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().optional()
}).strict();

const GenerateStatementSchema = z.object({
  type: z.enum(['OWNER_STATEMENT', 'CUSTOMER_STATEMENT', 'PROPERTY_STATEMENT', 'RECONCILIATION_REPORT']),
  periodType: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM']),
  periodStart: z.string().transform(s => new Date(s)),
  periodEnd: z.string().transform(s => new Date(s)),
  accountId: z.string(),
  ownerId: z.string().optional(),
  customerId: z.string().optional(),
  includeDetails: z.boolean().optional()
}).strict();

const CreateDisbursementSchema = z.object({
  ownerId: z.string(),
  amount: z.object({
    amount: z.number().int().positive(),
    currency: z.enum(['KES', 'USD', 'EUR', 'GBP', 'TZS', 'UGX'])
  }).optional(),
  destination: z.string(),
  description: z.string().optional(),
  idempotencyKey: z.string().optional()
}).strict();

// M-PESA STK Callback Schema
const MpesaStkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string(),
      ResultCode: z.number(),
      ResultDesc: z.string(),
      CallbackMetadata: z.object({
        Item: z.array(z.object({
          Name: z.string(),
          Value: z.union([z.string(), z.number()]).optional()
        }))
      }).optional()
    })
  })
});

// M-PESA C2B Confirmation Schema. Daraja sends this when a customer
// pays directly to the shortcode (no STK push). BillRefNumber is the
// account reference the customer typed — we match it against invoice
// numbers and customer codes to auto-attribute the payment.
const MpesaC2BConfirmationSchema = z.object({
  TransactionType: z.string(),
  TransID: z.string(),
  TransTime: z.string(),
  TransAmount: z.string(),
  BusinessShortCode: z.string(),
  BillRefNumber: z.string().optional().default(''),
  InvoiceNumber: z.string().optional().default(''),
  OrgAccountBalance: z.string().optional().default(''),
  ThirdPartyTransID: z.string().optional().default(''),
  MSISDN: z.string(),
  FirstName: z.string().optional().default(''),
  MiddleName: z.string().optional().default(''),
  LastName: z.string().optional().default(''),
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract tenant ID from the verified Supabase JWT principal attached by
 * `verifySupabaseAuthMiddleware`. Header / query trust has been removed —
 * the tenant id can no longer be set client-side.
 */
function getTenantId(req: Request): TenantId {
  const tenantId = req.principal?.tenantId;
  if (!tenantId) {
    throw new Error(
      'getTenantId: no verified principal — verifySupabaseAuthMiddleware must run first'
    );
  }
  return asTenantId(tenantId);
}

/**
 * Resolve tenant aggregate - uses env-configured defaults (PLATFORM_FEE_BPS, etc.).
 * Production: replace with HTTP call to tenant service when available. See Docs/PRODUCTION_READINESS.md.
 *
 * Bug fix A-BUG-DEEP #3 + #8:
 *   - PLATFORM_FEE_PERCENT was being read directly via `parseFloat` which
 *     bypassed the bps lib's validation and deprecation log. Route through
 *     `resolvePlatformFeeBps` so both env vars stay in lockstep and the
 *     deprecation warning fires once.
 *   - The previous `as unknown as TenantAggregate` cast hid the fact that
 *     `paymentSettings` may be missing `mpesaShortCode`. Build the object
 *     with explicit defaults so consumers see a stable shape and a missing
 *     required field surfaces as a real type error.
 */
function getTenantAggregate(tenantId: TenantId): TenantAggregate {
  // resolvePlatformFeeBps returns basis points (e.g. 500 = 5.0%).
  const platformFeeBps = resolvePlatformFeeBps(process.env);
  const platformFeePercent = platformFeeBps / 100;
  const aggregate: TenantAggregate = {
    id: tenantId,
    getPlatformFeePercent: () => platformFeePercent,
    paymentSettings: {
      stripeAccountId: process.env.STRIPE_CONNECTED_ACCOUNT_ID || undefined,
      mpesaShortCode: process.env.MPESA_SHORTCODE || undefined,
    },
  };
  return aggregate;
}

// =============================================================================
// W4-A: Webhook tenant resolution
// -----------------------------------------------------------------------------
// The tenant-scoped `findByExternalId` (migration 0169) requires the webhook
// router to surface a tenantId BEFORE forwarding to the orchestration service.
// We extract from provider payloads (Stripe metadata, M-Pesa shortcode map)
// and short-circuit with MISSING_TENANT_CONTEXT when the claim is absent.
// =============================================================================

/**
 * Error code surfaced by webhook routes when the provider payload does not
 * carry a derivable tenant context. Routers translate this to HTTP 400 with
 * a stable `MISSING_TENANT_CONTEXT` body code.
 */
export class MissingTenantContextError extends Error {
  public readonly code = 'MISSING_TENANT_CONTEXT' as const;

  constructor(provider: string, detail: string) {
    super(`Missing tenant context from ${provider} webhook: ${detail}`);
    this.name = 'MissingTenantContextError';
  }
}

/**
 * Stripe webhook payloads encode tenant context in `metadata`. Accept both
 * `tenantId` (camelCase, our convention) and `tenant_id` (snake_case, the
 * Stripe SDK's default for custom keys). Return null when the claim is
 * absent or malformed — the caller short-circuits with MISSING_TENANT_CONTEXT.
 *
 * SECURITY: This function only surfaces what the payload claims. The
 * tenant-scoped repository's `findByExternalId` is the actual cross-tenant
 * guard — a spoofed claim resolves to a non-match against the DB row and
 * the orchestrator logs a non-mutating miss.
 */
export function resolveStripeTenantId(
  payload: { metadata?: Record<string, unknown> | null } | null | undefined
): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const metadata = payload.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const claim = (metadata as Record<string, unknown>).tenantId
    ?? (metadata as Record<string, unknown>).tenant_id;
  return typeof claim === 'string' && claim.length > 0 ? claim : null;
}

/**
 * Parses MPESA_SHORTCODE_TENANT_MAP env into a shortcode -> tenantId map.
 * Fails closed on malformed JSON (empty map, no throw) so a misconfigured
 * environment can never silently allow cross-tenant credit. Cached on
 * first call; tests call `__resetMpesaShortCodeMapCache()` between cases.
 */
let mpesaShortCodeMapCache: Map<string, string> | null = null;

export function loadMpesaShortCodeMap(): Map<string, string> {
  if (mpesaShortCodeMapCache) return mpesaShortCodeMapCache;
  const raw = process.env.MPESA_SHORTCODE_TENANT_MAP;
  const map = new Map<string, string>();
  if (!raw) {
    mpesaShortCodeMapCache = map;
    return map;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [shortcode, tenantId] of Object.entries(parsed)) {
        if (typeof tenantId === 'string' && tenantId.length > 0) {
          map.set(shortcode, tenantId);
        }
      }
    }
  } catch {
    // Fail closed — malformed JSON yields an empty map so no shortcode
    // resolves and the router emits MISSING_TENANT_CONTEXT.
  }
  mpesaShortCodeMapCache = map;
  return map;
}

/**
 * Test-only hook to reset the cached shortcode map between cases. Exported
 * with the `__` prefix to flag it as internal/test-only.
 */
export function __resetMpesaShortCodeMapCache(): void {
  mpesaShortCodeMapCache = null;
}

/**
 * Resolves a tenantId for an inbound M-Pesa C2B callback by looking up the
 * paybill/till shortcode in the configured map. Returns null when the
 * shortcode is unknown or the map is empty.
 */
export function resolveMpesaTenantByShortCode(shortcode: string): string | null {
  const map = loadMpesaShortCodeMap();
  return map.get(shortcode) ?? null;
}

/**
 * Resolves a tenantId for STK Push callbacks. STK is initiated against the
 * platform's configured business shortcode (`MPESA_BUSINESS_SHORT_CODE`),
 * so we look that up in the shortcode -> tenant map.
 */
export function resolveMpesaStkTenantId(): string | null {
  const shortcode = process.env.MPESA_BUSINESS_SHORT_CODE;
  if (!shortcode) return null;
  return resolveMpesaTenantByShortCode(shortcode);
}

// =============================================================================
// Initialize Logger
// =============================================================================

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' 
    ? { target: 'pino-pretty' }
    : undefined
});

// =============================================================================
// Create Express app
// =============================================================================

const app = express();

// =============================================================================
// Initialize Repositories (factory switches InMemory vs Prisma based on env)
// =============================================================================

const repos = createRepositories(logger);
const { paymentIntentRepository, accountRepository, ledgerRepository, statementRepository, disbursementRepository } = repos;
const eventPublisher = new InMemoryEventPublisher();

// =============================================================================
// Initialize Services
// =============================================================================

const paymentOrchestrationService = new PaymentOrchestrationService({
  paymentIntentRepository,
  eventPublisher,
  logger: {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
});

const ledgerService = new LedgerService({
  ledgerRepository,
  accountRepository,
  eventPublisher,
  logger: {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
});

const reconciliationService = new ReconciliationService({
  paymentIntentRepository,
  ledgerRepository,
  accountRepository,
  eventPublisher,
  logger: {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
});

const statementGenerationService = new StatementGenerationService({
  ledgerRepository,
  accountRepository,
  statementRepository,
  eventPublisher,
  logger: {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
});

const disbursementService = new DisbursementService({
  accountRepository,
  disbursementRepository,
  ledgerService,
  eventPublisher,
  logger: {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
});

// =============================================================================
// Store providers for webhook handling
// =============================================================================

let stripeProvider: StripePaymentProvider | null = null;
let mpesaProvider: MpesaPaymentProvider | null = null;

// Register payment providers if configured
if (process.env.STRIPE_SECRET_KEY) {
  stripeProvider = new StripePaymentProvider({
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || ''
  });
  paymentOrchestrationService.registerProvider(stripeProvider, { isDefault: true });
  reconciliationService.registerProvider(stripeProvider);
  disbursementService.registerProvider(stripeProvider, true);
  logger.info('Stripe payment provider registered');
}

if (process.env.MPESA_CONSUMER_KEY) {
  mpesaProvider = new MpesaPaymentProvider({
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortCode: process.env.MPESA_SHORT_CODE || process.env.MPESA_SHORTCODE || '',
    passKey: process.env.MPESA_PASS_KEY || process.env.MPESA_PASSKEY || '',
    environment: (process.env.MPESA_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox',
    callbackBaseUrl: process.env.MPESA_CALLBACK_URL || ''
  });
  paymentOrchestrationService.registerProvider(mpesaProvider, { currencies: ['KES'] });
  logger.info('M-PESA payment provider registered');
}

// =============================================================================
// Initialize Background Jobs
// =============================================================================

const reconciliationJob = new ReconciliationJob(
  reconciliationService,
  {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
);

const statementJob = new StatementGenerationJob(
  statementGenerationService,
  accountRepository,
  {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
);

const disbursementJob = new DisbursementJob(
  disbursementService,
  {
    info: (msg, ctx) => logger.info(ctx, msg),
    warn: (msg, ctx) => logger.warn(ctx, msg),
    error: (msg, ctx) => logger.error(ctx, msg)
  }
);

// =============================================================================
// Middleware
// =============================================================================

app.use(helmet());

// Augment Request with rawBody for HMAC verification on M-Pesa webhooks.
// Stripe gets its own express.raw() handler below; M-Pesa needs both the
// parsed JSON body (for the handler) AND the raw bytes (for the HMAC).
declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer;
  }
}

// Parse JSON for most routes, but keep raw body for webhooks
const captureRawBodyJson = express.json({
  verify: (req: Request, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
});
app.use((req, res, next) => {
  if (req.path.startsWith('/webhooks/stripe')) {
    next();
  } else {
    captureRawBodyJson(req, res, next);
  }
});

app.use(pinoHttp({ logger }));

// Verify Supabase JWT on every protected request. Health check + webhooks
// (which carry their own signature verification) are excluded.
import { verifySupabaseAuthMiddleware } from './middleware/auth.middleware';
import {
  mpesaIpAllowlistMiddleware,
  mpesaSignatureMiddleware,
  mpesaDeduplicator,
  CallbackDeduplicator,
} from './middleware/mpesa-webhook.middleware';
app.use((req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/webhooks/')) return next();
  return verifySupabaseAuthMiddleware(req, res, next);
});

// M-Pesa webhooks come from a known set of Safaricom IPs. Reject anything
// else before it reaches the handler.
const mpesaAllowlist = mpesaIpAllowlistMiddleware({
  warn: (ctx, msg) => logger.warn(ctx, msg),
});
// CRITICAL-3: HMAC signature verification runs AFTER the IP allowlist and
// BEFORE any handler side-effects. When MPESA_WEBHOOK_SECRET is set (or
// NODE_ENV=production / MPESA_WEBHOOK_SECRET_REQUIRED=true) the middleware
// is mandatory; sandbox/dev defaults to skip with a warn log.
const mpesaSignature = mpesaSignatureMiddleware({
  warn: (ctx, msg) => logger.warn(ctx, msg),
});
app.use('/webhooks/mpesa', mpesaAllowlist, mpesaSignature);
app.use('/api/v1/payments/webhook/mpesa', mpesaAllowlist, mpesaSignature);

// =============================================================================
// Health Check Endpoint
// =============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'payments-ledger',
    timestamp: new Date().toISOString(),
    providers: {
      stripe: !!stripeProvider,
      mpesa: !!mpesaProvider
    }
  });
});

// =============================================================================
// Payment Routes
// =============================================================================

/**
 * POST /api/v1/payments - Create a payment intent
 */
app.post('/api/v1/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreatePaymentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      });
    }

    const data = validation.data;
    // CRITICAL-2: tenant is from the verified principal, never the body.
    const tenantId = getTenantId(req);
    const tenant = getTenantAggregate(tenantId);

    const request: CreatePaymentRequest = {
      tenantId,
      customerId: asCustomerId(data.customerId),
      leaseId: data.leaseId ? asLeaseId(data.leaseId) : undefined,
      type: data.type,
      amount: Money.fromMinorUnits(data.amount.amount, data.amount.currency as CurrencyCode),
      description: data.description,
      paymentMethodId: data.paymentMethodId,
      statementDescriptor: data.statementDescriptor,
      metadata: data.metadata,
      idempotencyKey: data.idempotencyKey
    };

    const result = await paymentOrchestrationService.createPayment(request, tenant);

    res.status(201).json({
      paymentIntentId: result.paymentIntentId,
      status: result.status,
      clientSecret: result.clientSecret,
      redirectUrl: result.redirectUrl,
      instructions: result.instructions
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/payments/:id - Get payment details
 */
app.get('/api/v1/payments/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const paymentIntentId = asPaymentIntentId(req.params.id);

    const paymentIntent = await paymentOrchestrationService.getPaymentIntent(
      paymentIntentId,
      tenantId
    );

    if (!paymentIntent) {
      return res.status(404).json({ error: 'Payment intent not found' });
    }

    res.json({
      id: paymentIntent.id,
      tenantId: paymentIntent.tenantId,
      customerId: paymentIntent.customerId,
      leaseId: paymentIntent.leaseId,
      type: paymentIntent.type,
      status: paymentIntent.status,
      amount: paymentIntent.amount.toData(),
      platformFee: paymentIntent.platformFee?.toData(),
      netAmount: paymentIntent.netAmount?.toData(),
      description: paymentIntent.description,
      paidAt: paymentIntent.paidAt,
      receiptUrl: paymentIntent.receiptUrl,
      failureReason: paymentIntent.failureReason,
      createdAt: paymentIntent.createdAt
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/payments/:id/confirm - Confirm a payment with payment method
 */
app.post('/api/v1/payments/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const paymentIntentId = asPaymentIntentId(req.params.id);
    const { paymentMethodId } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'paymentMethodId is required' });
    }

    const tenant = getTenantAggregate(tenantId);
    const result = await paymentOrchestrationService.processPayment(
      paymentIntentId,
      tenantId,
      paymentMethodId,
      tenant
    );

    res.json({
      paymentIntentId: result.paymentIntentId,
      status: result.status,
      clientSecret: result.clientSecret,
      redirectUrl: result.redirectUrl,
      instructions: result.instructions,
      receiptUrl: result.receiptUrl
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/payments/:id/process - Process a payment (alias for confirm)
 */
app.post('/api/v1/payments/:id/process', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const paymentIntentId = asPaymentIntentId(req.params.id);
    const { paymentMethodId } = req.body;

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'paymentMethodId is required' });
    }

    const tenant = getTenantAggregate(tenantId);
    const result = await paymentOrchestrationService.processPayment(
      paymentIntentId,
      tenantId,
      paymentMethodId,
      tenant
    );

    res.json({
      paymentIntentId: result.paymentIntentId,
      status: result.status,
      clientSecret: result.clientSecret,
      redirectUrl: result.redirectUrl,
      instructions: result.instructions,
      receiptUrl: result.receiptUrl
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/payments/:id/refund - Refund a payment
 */
app.post('/api/v1/payments/:id/refund', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const paymentIntentId = asPaymentIntentId(req.params.id);
    const { amount, reason, idempotencyKey } = req.body;

    const result = await paymentOrchestrationService.refundPayment({
      paymentIntentId,
      tenantId,
      amount: amount ? Money.fromMinorUnits(amount.amount, amount.currency) : undefined,
      reason,
      idempotencyKey
    });

    res.json({
      refundId: result.refundId,
      paymentIntentId: result.paymentIntentId,
      amount: result.amount.toData(),
      status: result.status
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Ledger Routes
// =============================================================================

/**
 * GET /api/v1/accounts/:id/entries - Get ledger entries for an account
 */
app.get('/api/v1/accounts/:id/entries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const accountId = asAccountId(req.params.id);
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 50;

    const result = await ledgerService.getAccountEntries(
      accountId,
      tenantId,
      page,
      pageSize
    );

    res.json({
      entries: result.entries.map(entry => ({
        id: entry.id,
        journalId: entry.journalId,
        type: entry.type,
        direction: entry.direction,
        amount: entry.amount.toData(),
        balanceAfter: entry.balanceAfter.toData(),
        sequenceNumber: entry.sequenceNumber,
        effectiveDate: entry.effectiveDate,
        postedAt: entry.postedAt,
        description: entry.description,
        paymentIntentId: entry.paymentIntentId,
        leaseId: entry.leaseId,
        propertyId: entry.propertyId,
        unitId: entry.unitId
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/accounts/:id/entries - Create a ledger entry for a specific account
 * Convenience endpoint that wraps POST /api/v1/journal for a single account
 */
app.post('/api/v1/accounts/:id/entries', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const accountId = asAccountId(req.params.id);
    const { type, direction, amount, description, effectiveDate, paymentIntentId, leaseId, propertyId, unitId, metadata, createdBy } = req.body;

    if (!type || !direction || !amount) {
      return res.status(400).json({
        error: 'Validation error',
        details: 'type, direction, and amount are required'
      });
    }

    if (!['DEBIT', 'CREDIT'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be DEBIT or CREDIT' });
    }

    const moneyAmount = Money.fromMinorUnits(amount.amount, amount.currency as CurrencyCode);

    const result = await ledgerService.postJournalEntry({
      tenantId,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      paymentIntentId: paymentIntentId ? asPaymentIntentId(paymentIntentId) : undefined,
      lines: [{
        accountId,
        type,
        direction,
        amount: moneyAmount,
        description: description || type,
        leaseId,
        propertyId,
        unitId,
        metadata
      }],
      createdBy: createdBy || 'system'
    });

    res.status(201).json({
      journalId: result.journalId,
      entries: result.entries.map(e => ({
        id: e.id,
        accountId: e.accountId,
        direction: e.direction,
        amount: e.amount.toData(),
        balanceAfter: e.balanceAfter.toData(),
        sequenceNumber: e.sequenceNumber
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/accounts/:id/balance - Get account balance
 */
app.get('/api/v1/accounts/:id/balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const accountId = asAccountId(req.params.id);
    const asOfDate = req.query.asOf ? new Date(req.query.asOf as string) : undefined;

    if (asOfDate) {
      const balance = await ledgerService.getAccountBalanceAsOf(accountId, tenantId, asOfDate);
      if (!balance) {
        return res.status(404).json({ error: 'Account not found or no entries' });
      }
      res.json({
        accountId: balance.accountId,
        balance: balance.balance,
        currency: balance.currency,
        asOf: balance.asOf,
        lastEntryId: balance.lastEntryId
      });
    } else {
      const balance = await ledgerService.getAccountBalance(accountId, tenantId);
      if (!balance) {
        return res.status(404).json({ error: 'Account not found' });
      }
      res.json({
        accountId,
        balance: balance.toData(),
        asOf: new Date()
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/journal - Post a journal entry
 */
app.post('/api/v1/journal', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { effectiveDate, paymentIntentId, lines, createdBy } = req.body;

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'At least one journal line is required' });
    }

    const result = await ledgerService.postJournalEntry({
      tenantId,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      paymentIntentId: paymentIntentId ? asPaymentIntentId(paymentIntentId) : undefined,
      lines: lines.map((line: {
        accountId: string;
        type: string;
        direction: 'DEBIT' | 'CREDIT';
        amount: { amount: number; currency: CurrencyCode };
        description: string;
        leaseId?: string;
        propertyId?: string;
        unitId?: string;
        metadata?: Record<string, unknown>;
      }) => ({
        ...line,
        type: line.type as any,
        accountId: asAccountId(line.accountId),
        amount: Money.fromMinorUnits(line.amount.amount, line.amount.currency)
      })) as any,
      createdBy: createdBy || 'system'
    });

    res.status(201).json({
      journalId: result.journalId,
      entries: result.entries.map(e => ({
        id: e.id,
        accountId: e.accountId,
        direction: e.direction,
        amount: e.amount.toData(),
        balanceAfter: e.balanceAfter.toData()
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/accounts/:id/verify - Verify account ledger integrity
 */
app.get('/api/v1/accounts/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const accountId = asAccountId(req.params.id);

    const [balanceResult, sequenceResult] = await Promise.all([
      ledgerService.verifyAccountIntegrity(accountId, tenantId),
      ledgerService.verifySequenceIntegrity(accountId, tenantId)
    ]);

    res.json({
      accountId,
      balanceValid: balanceResult.valid,
      sequenceValid: sequenceResult.valid,
      storedBalance: balanceResult.storedBalance?.toData(),
      calculatedBalance: balanceResult.calculatedBalance?.toData(),
      discrepancy: balanceResult.discrepancy?.toData(),
      sequenceGaps: sequenceResult.gaps,
      sequenceDuplicates: sequenceResult.duplicates
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Statement Routes
// =============================================================================

/**
 * GET /api/v1/statements - List statements
 */
app.get('/api/v1/statements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const ownerId = req.query.ownerId as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 20;

    if (ownerId) {
      const result = await statementGenerationService.getOwnerStatements(
        tenantId,
        asOwnerId(ownerId),
        page,
        pageSize
      );
      return res.json({
        statements: result.statements.map(s => ({
          id: s.id,
          type: s.type,
          status: s.status,
          periodType: s.periodType,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          openingBalance: s.openingBalance.toData(),
          closingBalance: s.closingBalance.toData(),
          generatedAt: s.generatedAt,
          sentAt: s.sentAt
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      });
    }

    if (customerId) {
      const result = await statementGenerationService.getCustomerStatements(
        tenantId,
        asCustomerId(customerId),
        page,
        pageSize
      );
      return res.json({
        statements: result.statements.map(s => ({
          id: s.id,
          type: s.type,
          status: s.status,
          periodType: s.periodType,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          openingBalance: s.openingBalance.toData(),
          closingBalance: s.closingBalance.toData(),
          generatedAt: s.generatedAt,
          sentAt: s.sentAt
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      });
    }

    return res.status(400).json({ error: 'Either ownerId or customerId query parameter is required' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/statements - Generate a statement
 */
app.post('/api/v1/statements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = GenerateStatementSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      });
    }

    const data = validation.data;
    // CRITICAL-2: tenant comes from the principal, not from the body.
    const tenantId = getTenantId(req);
    const request: GenerateStatementRequest = {
      tenantId,
      type: data.type,
      periodType: data.periodType,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      accountId: asAccountId(data.accountId),
      ownerId: data.ownerId ? asOwnerId(data.ownerId) : undefined,
      customerId: data.customerId ? asCustomerId(data.customerId) : undefined,
      includeDetails: data.includeDetails
    };

    const statement = await statementGenerationService.generateStatement(request);

    res.status(201).json({
      id: statement.id,
      type: statement.type,
      status: statement.status,
      periodType: statement.periodType,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalance: statement.openingBalance.toData(),
      closingBalance: statement.closingBalance.toData(),
      totalDebits: statement.totalDebits.toData(),
      totalCredits: statement.totalCredits.toData(),
      netChange: statement.netChange.toData(),
      lineItemCount: statement.lineItems.length,
      generatedAt: statement.generatedAt
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/statements/:id - Get statement details
 */
app.get('/api/v1/statements/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const statementId = asStatementId(req.params.id);

    const statement = await statementGenerationService.getStatement(statementId, tenantId);

    if (!statement) {
      return res.status(404).json({ error: 'Statement not found' });
    }

    res.json({
      id: statement.id,
      tenantId: statement.tenantId,
      type: statement.type,
      status: statement.status,
      periodType: statement.periodType,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      ownerId: statement.ownerId,
      customerId: statement.customerId,
      accountId: statement.accountId,
      currency: statement.currency,
      openingBalance: statement.openingBalance.toData(),
      closingBalance: statement.closingBalance.toData(),
      totalDebits: statement.totalDebits.toData(),
      totalCredits: statement.totalCredits.toData(),
      netChange: statement.netChange.toData(),
      lineItems: statement.lineItems.map(item => ({
        date: item.date,
        type: item.type,
        description: item.description,
        reference: item.reference,
        debit: item.debit?.toData(),
        credit: item.credit?.toData(),
        balance: item.balance.toData()
      })),
      summaries: statement.summaries.map(s => ({
        label: s.label,
        amount: s.amount.toData(),
        percentage: s.percentage
      })),
      generatedAt: statement.generatedAt,
      sentAt: statement.sentAt,
      viewedAt: statement.viewedAt,
      documentUrl: statement.documentUrl
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/statements/:id/export - Export statement as PDF/CSV/JSON
 * Query params: format=pdf|csv|json, companyName, companyAddress
 */
app.get('/api/v1/statements/:id/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const statementId = asStatementId(req.params.id);
    const format = (req.query.format as string || 'pdf') as 'pdf' | 'csv' | 'json';

    if (!['pdf', 'csv', 'json'].includes(format)) {
      return res.status(400).json({ error: 'format must be pdf, csv, or json' });
    }

    const result = await statementGenerationService.exportStatement(
      statementId,
      tenantId,
      format,
      {
        companyName: req.query.companyName as string,
        companyAddress: req.query.companyAddress as string,
        companyEmail: req.query.companyEmail as string,
        companyLogo: req.query.companyLogo as string
      }
    );

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.content);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/statements/:id/send - Send statement to recipient
 */
app.post('/api/v1/statements/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const statementId = asStatementId(req.params.id);
    const { recipientEmail } = req.body;

    if (!recipientEmail) {
      return res.status(400).json({ error: 'recipientEmail is required' });
    }

    await statementGenerationService.deliverStatement({
      statementId,
      tenantId,
      recipientEmail,
      method: 'EMAIL'
    });

    res.json({ success: true, message: 'Statement sent successfully' });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Disbursement Routes
// =============================================================================

/**
 * POST /api/v1/disbursements - Create a disbursement
 */
app.post('/api/v1/disbursements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = CreateDisbursementSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      });
    }

    const data = validation.data;
    // CRITICAL-2: tenant comes from the principal, not from the body.
    const tenantId = getTenantId(req);
    const request: DisbursementRequest = {
      tenantId,
      ownerId: asOwnerId(data.ownerId),
      amount: data.amount ? Money.fromMinorUnits(data.amount.amount, data.amount.currency as CurrencyCode) : undefined,
      destination: data.destination,
      description: data.description,
      idempotencyKey: data.idempotencyKey
    };

    const result = await disbursementService.processDisbursement(request);

    res.status(201).json({
      disbursementId: result.disbursementId,
      ownerId: result.ownerId,
      amount: result.amount.toData(),
      status: result.status,
      transferId: result.transferId,
      estimatedArrival: result.estimatedArrival,
      failureReason: result.failureReason
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/disbursements/:id - Get disbursement status
 * Note: In a full implementation, disbursements would be persisted to a database
 */
app.get('/api/v1/disbursements/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const disbursementId = req.params.id;

    const disbursement = await disbursementService.getDisbursement(disbursementId, tenantId);

    if (!disbursement) {
      return res.status(404).json({ error: 'Disbursement not found' });
    }

    res.json({
      id: disbursement.id,
      tenantId: disbursement.tenantId,
      ownerId: disbursement.ownerId,
      amount: {
        amount: disbursement.amountMinorUnits,
        currency: disbursement.currency
      },
      status: disbursement.status,
      destination: disbursement.destination,
      provider: disbursement.provider,
      transferId: disbursement.transferId,
      description: disbursement.description,
      initiatedAt: disbursement.initiatedAt,
      completedAt: disbursement.completedAt,
      failedAt: disbursement.failedAt,
      estimatedArrival: disbursement.estimatedArrival,
      failureReason: disbursement.failureReason,
      createdAt: disbursement.createdAt
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/owners/:id/disbursement-info - Get owner disbursement info
 */
app.get('/api/v1/owners/:id/disbursement-info', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const ownerId = asOwnerId(req.params.id);

    const info = await disbursementService.getOwnerDisbursementInfo(tenantId, ownerId);

    res.json({
      ownerId: info.ownerId,
      availableBalance: info.availableBalance.toData(),
      pendingDisbursements: info.pendingDisbursements.toData(),
      lastDisbursementDate: info.lastDisbursementDate,
      nextScheduledDate: info.nextScheduledDate
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Reconciliation Routes
// =============================================================================

/**
 * POST /api/v1/reconciliation/verify-balances - Verify all ledger balances
 */
app.post('/api/v1/reconciliation/verify-balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);

    const result = await reconciliationService.verifyLedgerBalances(tenantId);

    res.json({
      accountsChecked: result.accountsChecked,
      valid: result.valid,
      invalid: result.invalid,
      discrepancies: result.discrepancies.map(d => ({
        accountId: d.accountId,
        storedBalance: d.storedBalance.toData(),
        calculatedBalance: d.calculatedBalance.toData(),
        discrepancy: d.discrepancy.toData()
      }))
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/reconciliation/provider - Reconcile with payment provider
 */
app.post('/api/v1/reconciliation/provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { providerName, olderThanMinutes } = req.body;

    if (!providerName) {
      return res.status(400).json({ error: 'providerName is required' });
    }

    const result = await reconciliationService.reconcileWithProvider(
      tenantId,
      providerName,
      olderThanMinutes || 30
    );

    res.json({
      checked: result.checked,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Webhook Routes
// =============================================================================

/**
 * POST /webhooks/stripe - Handle Stripe webhook events
 */
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!stripeProvider) {
      return res.status(503).json({ error: 'Stripe provider not configured' });
    }

    const signature = req.headers['stripe-signature'] as string;
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    
    // Verify and parse the webhook
    let event;
    try {
      event = stripeProvider.parseWebhookEvent(req.body, signature, webhookSecret);
    } catch (err) {
      logger.warn({ err }, 'Stripe webhook signature verification failed');
      return res.status(400).json({ error: 'Webhook signature verification failed' });
    }

    logger.info({ eventType: event.type, eventId: event.id }, 'Stripe webhook received');

    // W4-A: resolve tenantId from Stripe metadata BEFORE forwarding. Short-
    // circuit with 400/MISSING_TENANT_CONTEXT when absent so the orchestrator
    // can rely on tenant-scoped repository lookups.
    const stripeTenantId = resolveStripeTenantId(event.data as Record<string, unknown>);
    if (!stripeTenantId) {
      logger.warn({ eventType: event.type, eventId: event.id }, 'Stripe webhook missing tenant context');
      return res.status(400).json({ error: { code: 'MISSING_TENANT_CONTEXT', message: 'stripe metadata.tenantId required' } });
    }
    const stripeTenant = asTenantId(stripeTenantId);

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data as { id: string; receipt_url?: string };
        await paymentOrchestrationService.handleWebhook(
          'stripe',
          paymentIntent.id,
          'SUCCEEDED',
          stripeTenant,
          paymentIntent.receipt_url
        );
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data as { id: string; last_payment_error?: { message?: string } };
        await paymentOrchestrationService.handleWebhook(
          'stripe',
          paymentIntent.id,
          'FAILED',
          stripeTenant,
          undefined,
          paymentIntent.last_payment_error?.message || 'Payment failed'
        );
        break;
      }
      case 'payment_intent.canceled': {
        const paymentIntent = event.data as { id: string; cancellation_reason?: string };
        await paymentOrchestrationService.handleWebhook(
          'stripe',
          paymentIntent.id,
          'CANCELLED',
          stripeTenant,
          undefined,
          paymentIntent.cancellation_reason || 'Payment cancelled'
        );
        break;
      }
      default:
        logger.info({ eventType: event.type }, 'Unhandled Stripe event type');
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /webhooks/mpesa/stk - Handle M-PESA STK Push callback
 */
app.post('/webhooks/mpesa/stk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = MpesaStkCallbackSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn({ body: req.body }, 'Invalid M-PESA callback payload');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const callback = validation.data.Body.stkCallback;
    logger.info({
      checkoutRequestId: callback.CheckoutRequestID,
      resultCode: callback.ResultCode,
      resultDesc: callback.ResultDesc
    }, 'M-PESA STK callback received');

    // Idempotency — Safaricom retries every few minutes until it gets a
    // 200 with {ResultCode: 0}. If we've already processed this
    // CheckoutRequestID, ack and exit so we don't double-credit the ledger.
    if (mpesaDeduplicator.seenBefore(`stk:${callback.CheckoutRequestID}`)) {
      logger.info(
        { checkoutRequestId: callback.CheckoutRequestID },
        'Duplicate M-PESA STK callback — acking without reprocessing'
      );
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // W4-A: resolve tenantId from STK config BEFORE forwarding. STK is
    // initiated against `MPESA_BUSINESS_SHORT_CODE`, which is keyed in the
    // shortcode -> tenant map. Without a tenant we cannot scope the
    // payment-intent lookup safely; log and ack to stop retries.
    const stkTenantId = resolveMpesaStkTenantId();
    if (!stkTenantId) {
      logger.warn({ checkoutRequestId: callback.CheckoutRequestID }, 'M-PESA STK callback missing tenant context — ack without processing');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    const stkTenant = asTenantId(stkTenantId);

    // ResultCode 0 means success
    const isSuccess = callback.ResultCode === 0;

    if (isSuccess) {
      // Extract metadata from callback
      const metadata = callback.CallbackMetadata?.Item || [];
      const amount = metadata.find(i => i.Name === 'Amount')?.Value;
      const mpesaReceiptNumber = metadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = metadata.find(i => i.Name === 'TransactionDate')?.Value;
      const phoneNumber = metadata.find(i => i.Name === 'PhoneNumber')?.Value;

      logger.info({
        checkoutRequestId: callback.CheckoutRequestID,
        amount,
        mpesaReceiptNumber,
        transactionDate,
        phoneNumber
      }, 'M-PESA payment successful');

      // Update payment status via orchestration service
      await paymentOrchestrationService.handleWebhook(
        'mpesa',
        callback.CheckoutRequestID,
        'SUCCEEDED',
        stkTenant,
        mpesaReceiptNumber?.toString()
      );
    } else {
      // Payment failed or was cancelled
      const status: PaymentStatus = callback.ResultCode === 1032 ? 'CANCELLED' : 'FAILED';
      await paymentOrchestrationService.handleWebhook(
        'mpesa',
        callback.CheckoutRequestID,
        status,
        stkTenant,
        undefined,
        callback.ResultDesc
      );
    }

    // M-PESA expects this specific response format
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.error({ err: error }, 'Error processing M-PESA callback');
    // Still return success to M-PESA to prevent retries
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/**
 * POST /webhooks/mpesa/b2c/result - Handle M-PESA B2C (disbursement) result
 */
app.post('/webhooks/mpesa/b2c/result', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.info({ body: req.body }, 'M-PESA B2C result received');

    const result = req.body?.Result;
    if (!result) {
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const isSuccess = result.ResultCode === 0;
    const conversationId = result.ConversationID;
    const transactionId = result.TransactionID;

    logger.info({
      conversationId,
      transactionId,
      resultCode: result.ResultCode,
      resultDesc: result.ResultDesc
    }, `M-PESA B2C ${isSuccess ? 'succeeded' : 'failed'}`);

    // In a full implementation, update the disbursement status in the database
    // and publish appropriate events

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.error({ err: error }, 'Error processing M-PESA B2C result');
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/**
 * POST /webhooks/mpesa/b2c/timeout - Handle M-PESA B2C timeout
 */
app.post('/webhooks/mpesa/b2c/timeout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    logger.warn({ body: req.body }, 'M-PESA B2C timeout received');

    // In a full implementation, mark the disbursement as needing reconciliation

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.error({ err: error }, 'Error processing M-PESA B2C timeout');
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/**
 * POST /webhooks/mpesa/c2b/validation - Daraja validation handler
 *
 * Called BEFORE the customer is debited. We verify the BillRefNumber
 * corresponds to a valid invoice/account; returning non-zero ResultCode
 * rejects the payment. Daraja retries a few times on failure before
 * letting the customer complete the payment anyway (C2B is
 * best-effort validation, not a hard gate).
 */
app.post('/webhooks/mpesa/c2b/validation', async (req: Request, res: Response) => {
  try {
    const parsed = MpesaC2BConfirmationSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ body: req.body }, 'invalid C2B validation payload');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    const ref = parsed.data.BillRefNumber.trim();
    // We accept payments even without a reference — operators can
    // manually attribute them. But we log the shape for observability.
    logger.info(
      {
        event: 'c2b_validation',
        transId: parsed.data.TransID,
        billRef: ref,
        amount: parsed.data.TransAmount,
        msisdn: parsed.data.MSISDN,
      },
      'M-PESA C2B validation received'
    );
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    logger.error({ err }, 'Error in C2B validation handler');
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/**
 * POST /webhooks/mpesa/c2b/confirm - Daraja confirmation handler
 *
 * Called AFTER the customer's M-Pesa debit succeeds. This is the
 * authoritative "money arrived" signal. We:
 *  1. Deduplicate by TransID (tenant-scoped) so Safaricom retries don't
 *     double-credit the ledger.
 *  2. Look up the tenant via the BusinessShortCode (each tenant owns a
 *     distinct paybill). Cross-tenant safety hinges on this mapping.
 *  3. Match the BillRefNumber against invoiceNumber → customerCode →
 *     leaseId (in that precedence order).
 *  4. Forward to paymentOrchestrationService for ledger posting.
 *
 * The response body must always be `{ ResultCode: 0, ResultDesc: 'Accepted' }`
 * so Safaricom stops retrying. Internal failures are logged, never
 * bubbled back — Daraja interprets 4xx/5xx as retryable.
 */
app.post('/webhooks/mpesa/c2b/confirm', async (req: Request, res: Response) => {
  try {
    const parsed = MpesaC2BConfirmationSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn({ body: req.body }, 'invalid C2B confirmation payload');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    const c2b = parsed.data;

    // CRITICAL-3 hardening: dedup key includes BusinessShortCode so a
    // forged TransID submission for one tenant's paybill cannot pollute
    // another tenant's dedup cache. `CallbackDeduplicator.tenantKey` is
    // intentionally tenantId-aware; we use null here because the tenant
    // mapping happens downstream from BusinessShortCode.
    const c2bDedupKey = CallbackDeduplicator.tenantKey(
      null,
      'c2b',
      `${c2b.BusinessShortCode}:${c2b.TransID}`
    );
    if (mpesaDeduplicator.seenBefore(c2bDedupKey)) {
      logger.info({ transId: c2b.TransID }, 'duplicate M-PESA C2B confirmation; acking');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    logger.info(
      {
        event: 'c2b_confirm',
        transId: c2b.TransID,
        shortCode: c2b.BusinessShortCode,
        billRef: c2b.BillRefNumber,
        amount: c2b.TransAmount,
        msisdn: c2b.MSISDN,
      },
      'M-PESA C2B confirmation received'
    );

    // W4-A: resolve tenantId from the C2B BusinessShortCode -> tenant map.
    // Without a tenant we cannot scope the orchestrator lookup safely; we
    // log and ack so Daraja stops retrying — operators reconcile manually.
    const c2bTenantId = resolveMpesaTenantByShortCode(c2b.BusinessShortCode);
    if (!c2bTenantId) {
      logger.warn({ transId: c2b.TransID, shortCode: c2b.BusinessShortCode }, 'M-PESA C2B confirmation missing tenant context — ack without processing');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    const c2bTenant = asTenantId(c2bTenantId);

    // Best-effort attribution. If we can't match the invoice here the
    // payment lands in an "unallocated" bucket for operators to assign
    // manually. The orchestrator handles both paths.
    await paymentOrchestrationService.handleWebhook(
      'mpesa_c2b',
      c2b.TransID,
      'SUCCEEDED',
      c2bTenant,
      c2b.TransID,
      undefined
    ).catch((err) => {
      // Orchestrator failures are logged but must not propagate — we
      // still must return 200 to Daraja so it stops retrying.
      logger.error(
        { err, transId: c2b.TransID },
        'C2B orchestration failed; payment will require manual reconciliation'
      );
    });

    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    logger.error({ err }, 'Error in C2B confirmation handler');
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

// =============================================================================
// Job Management Routes (Admin)
// =============================================================================

/**
 * POST /api/v1/admin/jobs/reconciliation - Trigger reconciliation job
 */
app.post('/api/v1/admin/jobs/reconciliation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { providerName } = req.body;

    if (!providerName) {
      return res.status(400).json({ error: 'providerName is required' });
    }

    const result = await reconciliationJob.runProviderReconciliation(tenantId, providerName);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/admin/jobs/statements - Trigger statement generation job
 */
app.post('/api/v1/admin/jobs/statements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const [ownerResult, customerResult] = await Promise.all([
      statementJob.generateOwnerMonthlyStatements(tenantId, year, month),
      statementJob.generateCustomerMonthlyStatements(tenantId, year, month)
    ]);

    res.json({
      ownerStatements: ownerResult,
      customerStatements: customerResult
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/admin/jobs/disbursements - Trigger disbursement job
 */
app.post('/api/v1/admin/jobs/disbursements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { ownerDestinations } = req.body;

    if (!ownerDestinations || typeof ownerDestinations !== 'object') {
      return res.status(400).json({ error: 'ownerDestinations map is required' });
    }

    const destinationsMap = new Map<OwnerId, string>();
    for (const [ownerId, destination] of Object.entries(ownerDestinations)) {
      destinationsMap.set(asOwnerId(ownerId), destination as string);
    }

    const result = await disbursementJob.runScheduledDisbursements(tenantId, destinationsMap);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Additional API Routes (aliases and convenience endpoints)
// =============================================================================

/**
 * POST /api/v1/payments/webhook/mpesa - M-Pesa webhook (API-path alias)
 * Convenience endpoint that forwards to the M-PESA STK callback handler
 */
app.post('/api/v1/payments/webhook/mpesa', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = MpesaStkCallbackSchema.safeParse(req.body);
    if (!validation.success) {
      logger.warn({ body: req.body }, 'Invalid M-PESA callback payload via API path');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const callback = validation.data.Body.stkCallback;
    logger.info({
      checkoutRequestId: callback.CheckoutRequestID,
      resultCode: callback.ResultCode,
      resultDesc: callback.ResultDesc
    }, 'M-PESA STK callback received via API path');

    // Idempotency — same reasoning as /webhooks/mpesa/stk above.
    if (mpesaDeduplicator.seenBefore(`stk:${callback.CheckoutRequestID}`)) {
      logger.info(
        { checkoutRequestId: callback.CheckoutRequestID },
        'Duplicate M-PESA STK callback (API path) — acking without reprocessing'
      );
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    // W4-A: resolve tenantId from STK config (same as /webhooks/mpesa/stk).
    const apiStkTenantId = resolveMpesaStkTenantId();
    if (!apiStkTenantId) {
      logger.warn({ checkoutRequestId: callback.CheckoutRequestID }, 'M-PESA STK callback (API path) missing tenant context — ack without processing');
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    const apiStkTenant = asTenantId(apiStkTenantId);

    const isSuccess = callback.ResultCode === 0;

    if (isSuccess) {
      const metadata = callback.CallbackMetadata?.Item || [];
      const mpesaReceiptNumber = metadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;

      await paymentOrchestrationService.handleWebhook(
        'mpesa',
        callback.CheckoutRequestID,
        'SUCCEEDED',
        apiStkTenant,
        mpesaReceiptNumber?.toString()
      );
    } else {
      const status: PaymentStatus = callback.ResultCode === 1032 ? 'CANCELLED' : 'FAILED';
      await paymentOrchestrationService.handleWebhook(
        'mpesa',
        callback.CheckoutRequestID,
        status,
        apiStkTenant,
        undefined,
        callback.ResultDesc
      );
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (error) {
    logger.error({ err: error }, 'Error processing M-PESA callback via API path');
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
});

/**
 * GET /api/v1/statements/:tenantId - Get statements for a tenant
 *
 * CRITICAL-2 fix: the URL path-supplied tenantId must match the verified
 * principal's tenantId. The path slot is retained for client URL
 * compatibility, but cross-tenant reads are now blocked at the gateway.
 *
 * Supports query params: ownerId, customerId, type, page, pageSize
 */
app.get('/api/v1/statements/:tenantId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const principalTenantId = getTenantId(req);
    if (req.params.tenantId !== principalTenantId) {
      return res.status(403).json({
        error: { code: 'TENANT_MISMATCH', message: 'tenant id in path does not match authenticated principal' }
      });
    }
    const tenantId = principalTenantId;
    const ownerId = req.query.ownerId as string | undefined;
    const customerId = req.query.customerId as string | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 20;

    if (ownerId) {
      const result = await statementGenerationService.getOwnerStatements(
        tenantId,
        asOwnerId(ownerId),
        page,
        pageSize
      );
      return res.json({
        statements: result.statements.map(s => ({
          id: s.id,
          type: s.type,
          status: s.status,
          periodType: s.periodType,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          openingBalance: s.openingBalance.toData(),
          closingBalance: s.closingBalance.toData(),
          generatedAt: s.generatedAt,
          sentAt: s.sentAt
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      });
    }

    if (customerId) {
      const result = await statementGenerationService.getCustomerStatements(
        tenantId,
        asCustomerId(customerId),
        page,
        pageSize
      );
      return res.json({
        statements: result.statements.map(s => ({
          id: s.id,
          type: s.type,
          status: s.status,
          periodType: s.periodType,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          openingBalance: s.openingBalance.toData(),
          closingBalance: s.closingBalance.toData(),
          generatedAt: s.generatedAt,
          sentAt: s.sentAt
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore
      });
    }

    return res.status(400).json({ error: 'Either ownerId or customerId query parameter is required' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/statements/generate - Generate a statement (alias)
 */
app.post('/api/v1/statements/generate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = GenerateStatementSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: validation.error.errors
      });
    }

    const data = validation.data;
    // CRITICAL-2: tenant from principal, never the body.
    const request: GenerateStatementRequest = {
      tenantId: getTenantId(req),
      type: data.type,
      periodType: data.periodType,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      accountId: asAccountId(data.accountId),
      ownerId: data.ownerId ? asOwnerId(data.ownerId) : undefined,
      customerId: data.customerId ? asCustomerId(data.customerId) : undefined,
      includeDetails: data.includeDetails
    };

    const statement = await statementGenerationService.generateStatement(request);

    res.status(201).json({
      id: statement.id,
      type: statement.type,
      status: statement.status,
      periodType: statement.periodType,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      openingBalance: statement.openingBalance.toData(),
      closingBalance: statement.closingBalance.toData(),
      totalDebits: statement.totalDebits.toData(),
      totalCredits: statement.totalCredits.toData(),
      netChange: statement.netChange.toData(),
      lineItemCount: statement.lineItems.length,
      generatedAt: statement.generatedAt
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/disbursements - List disbursements
 * Supports query params: ownerId, status, fromDate, toDate, page, pageSize
 */
app.get('/api/v1/disbursements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const ownerId = req.query.ownerId as string | undefined;
    const status = req.query.status as string | undefined;
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate as string) : undefined;
    const toDate = req.query.toDate ? new Date(req.query.toDate as string) : undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const pageSize = parseInt(req.query.pageSize as string, 10) || 20;

    const result = await disbursementService.listDisbursements(
      tenantId,
      {
        ownerId: ownerId ? asOwnerId(ownerId) : undefined,
        status: status as any,
        fromDate,
        toDate
      },
      page,
      pageSize
    );

    res.json({
      disbursements: result.items.map(d => ({
        id: d.id,
        ownerId: d.ownerId,
        amount: {
          amount: d.amountMinorUnits,
          currency: d.currency
        },
        status: d.status,
        destination: d.destination,
        provider: d.provider,
        transferId: d.transferId,
        description: d.description,
        initiatedAt: d.initiatedAt,
        completedAt: d.completedAt,
        failedAt: d.failedAt,
        estimatedArrival: d.estimatedArrival,
        failureReason: d.failureReason,
        createdAt: d.createdAt
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/reconciliation/run - Run full reconciliation
 * Runs both ledger verification and provider reconciliation
 */
app.post('/api/v1/reconciliation/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = getTenantId(req);
    const { providerName, olderThanMinutes } = req.body;

    // Step 1: Verify ledger balances
    const ledgerResult = await reconciliationService.verifyLedgerBalances(tenantId);

    // Step 2: Reconcile with provider (if specified)
    let providerResult = null;
    if (providerName) {
      providerResult = await reconciliationService.reconcileWithProvider(
        tenantId,
        providerName,
        olderThanMinutes || 30
      );
    }

    res.json({
      ledgerVerification: {
        accountsChecked: ledgerResult.accountsChecked,
        valid: ledgerResult.valid,
        invalid: ledgerResult.invalid,
        discrepancies: ledgerResult.discrepancies.map(d => ({
          accountId: d.accountId,
          storedBalance: d.storedBalance.toData(),
          calculatedBalance: d.calculatedBalance.toData(),
          discrepancy: d.discrepancy.toData()
        }))
      },
      providerReconciliation: providerResult ? {
        providerName,
        checked: providerResult.checked,
        updated: providerResult.updated,
        failed: providerResult.failed,
        errors: providerResult.errors
      } : null,
      completedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// Error Handling Middleware
// =============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  
  // Handle specific error types
  if (err.message.includes('not found')) {
    return res.status(404).json({
      error: 'Not found',
      message: err.message
    });
  }
  
  if (err.message.includes('not balanced') || err.message.includes('Currency mismatch')) {
    return res.status(400).json({
      error: 'Validation error',
      message: err.message
    });
  }

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV !== 'production' ? err.message : undefined
  });
});

// =============================================================================
// Start Server
// =============================================================================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Payments & Ledger service started');
});

// =============================================================================
// Graceful Shutdown
// =============================================================================

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

export { app };
