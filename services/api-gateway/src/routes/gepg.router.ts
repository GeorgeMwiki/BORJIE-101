// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple c.json({...}, status) branches widen return type and TypedResponse overload rejects the union. Tracked at hono-dev/hono#3891.
/**
 * GePG (Tanzania Government e-Payment Gateway) router
 *
 * Endpoints:
 *   POST /v1/payments/gepg/control-numbers     -> issue a control number
 *   POST /v1/payments/gepg/callback            -> receive payment callback
 *   GET  /v1/payments/gepg/control-numbers/:id -> query status
 *
 * The callback endpoint verifies the signature BEFORE parsing the body.
 * Direct GePG mode uses RSA-SHA256 XML-DSig (gepg-rsa-signature.ts);
 * PSP-shortcut mode uses HMAC. See providers/gepg/gepg-signature.ts.
 * Live direct-mode HTTP calls are deferred — see KI-006 in
 * Docs/KNOWN_ISSUES.md.
 */
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';
import {
  createGepgProvider,
  verifyGepgSignature,
  type GepgConfig,
  type GepgProvider,
} from '@borjie/payments-service/providers/gepg';
import type { GepgSignatureConfig } from '@borjie/payments-service/providers/gepg';

import { withSecurityEvents, requireEnv } from '@borjie/observability';
function loadConfig(): GepgConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const callbackBaseUrl = process.env.GEPG_CALLBACK_BASE_URL;
  if (isProd && !callbackBaseUrl) {
    throw new Error(
      'gepg: GEPG_CALLBACK_BASE_URL env var is required in production.'
    );
  }
  // GePG identity (SP / SP-Sys-Id / base URL) and environment MUST be set
  // explicitly in production — silent "SANDBOX_*" defaults would route real
  // tenant traffic at the wrong gateway and break reconciliation.
  if (isProd) {
    requireEnv('GEPG_SP');
    requireEnv('GEPG_SP_SYS_ID');
    requireEnv('GEPG_BASE_URL');
    requireEnv('GEPG_ENV');
  }
  return {
    sp: process.env.GEPG_SP ?? 'SANDBOX_SP',
    spSysId: process.env.GEPG_SP_SYS_ID ?? 'SANDBOX_SYSID',
    pkcs12Path: process.env.GEPG_PKCS12_PATH,
    pkcs12Password: process.env.GEPG_PKCS12_PASSWORD,
    environment:
      (process.env.GEPG_ENV as 'sandbox' | 'production') ?? 'sandbox',
    baseUrl: process.env.GEPG_BASE_URL ?? 'https://sandbox.gepg.tz',
    // Dev fallback — production throws above.
    callbackBaseUrl: callbackBaseUrl ?? 'http://localhost:3000',
    pspMode: process.env.GEPG_PSP_MODE !== 'false',
  };
}

function loadSignatureConfig(): GepgSignatureConfig {
  const pspMode = process.env.GEPG_PSP_MODE !== 'false';
  return {
    mode: pspMode ? 'hmac-psp' : 'rsa-gepg',
    hmacSecret: process.env.GEPG_HMAC_SECRET,
    gepgPublicCertPem: process.env.GEPG_PUBLIC_CERT_PEM,
  };
}

// Provider instance is request-scoped so tests can inject mocks.
function getProvider(c: { get: (k: string) => unknown }): GepgProvider {
  const injected = c.get('gepgProvider');
  if (injected) return injected as GepgProvider;
  return createGepgProvider({
    config: loadConfig(),
    signatureConfig: loadSignatureConfig(),
  });
}

// ----------------------------------------------------------------------------
// Schemas
// ----------------------------------------------------------------------------

const ControlNumberCreateSchema = z.object({
  invoiceId: z.string().min(1),
  billId: z.string().min(1).max(64),
  amountMinorUnits: z.number().int().positive(),
  currency: z.enum(['TZS', 'USD']),
  payerName: z.string().min(1).max(200),
  payerPhone: z
    .string()
    .regex(/^[+0-9 \-()]+$/)
    .max(24)
    .optional(),
  payerEmail: z.string().email().optional(),
  description: z.string().min(1).max(500),
  expiresAt: z.string().datetime().optional(),
});

const CallbackSchema = z.object({
  controlNumber: z.string().min(1),
  billId: z.string().min(1),
  paidAmount: z.number().int().nonnegative(),
  currency: z.string(),
  paidAt: z.string(),
  pspReceiptNumber: z.string().min(1),
  pspChannel: z.string(),
  payerName: z.string().optional(),
  payerPhone: z.string().optional(),
});

// ----------------------------------------------------------------------------
// Signature verification middleware (callback only)
//
// HIGH-6 (audit .audit/post-pr90-api-mcp-bug-sweep.md): The old middleware
// only CHECKED that an `X-GePG-Signature` header existed; it didn't
// actually verify the signature. Verification was deferred to the
// provider AFTER the body was JSON-parsed. The file's own header comment
// (line 10) claimed "verifies the signature BEFORE parsing the body" —
// the implementation did the opposite. We now perform the cryptographic
// verification HERE so a forged callback is rejected before any side
// effect. Error details stay server-side; the response is a generic 401.
// ----------------------------------------------------------------------------

const signatureMiddleware = createMiddleware(async (c, next) => {
  const raw = await c.req.text();
  c.set('gepgRawBody', raw);
  const signature =
    c.req.header('X-GePG-Signature') ?? c.req.header('x-gepg-signature');
  if (!signature) {
    return c.json(
      {
        success: false,
        error: { code: 'MISSING_SIGNATURE', message: 'X-GePG-Signature header required' },
      },
      401
    );
  }
  // HIGH-6: verify signature BEFORE the body is parsed. We construct a
  // signature-only verifier from the same config the provider uses.
  try {
    const verification = verifyGepgSignature(raw, signature, loadSignatureConfig());
    if (!verification.valid) {
      // Detailed reason stays server-side; response is generic.
      console.warn('[gepg] signature rejected', verification.reason ?? 'unknown');
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_SIGNATURE', message: 'signature verification failed' },
        },
        401
      );
    }
  } catch (err) {
    console.warn('[gepg] signature verification threw', err instanceof Error ? err.message : 'unknown');
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'signature verification failed' },
      },
      401
    );
  }
  c.set('gepgSignature', signature);
  await next();
});

// ----------------------------------------------------------------------------
// Router
// ----------------------------------------------------------------------------

const app = new Hono();

// --- POST /v1/payments/gepg/control-numbers ---------------------------------
app.post(
  '/control-numbers',
  authMiddleware,
  zValidator('json', ControlNumberCreateSchema),
  withSecurityEvents({ action: 'gepg.create', resource: 'gepg', severity: 'info' }, async (c) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const provider = getProvider(c);

    try {
      const response = await provider.requestControlNumber({
        tenantId: auth.tenantId,
        invoiceId: body.invoiceId,
        billId: body.billId,
        amount: body.amountMinorUnits,
        currency: body.currency,
        payerName: body.payerName,
        payerPhone: body.payerPhone,
        payerEmail: body.payerEmail,
        description: body.description,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });

      return c.json({ success: true, data: response }, 201);
    } catch (err) {
      return routeCatch(c, err, {
        code: 'GEPG_ERROR',
        status: 502,
        fallback: 'GePG gateway error',
      });
    }
  })
);

// --- GET /v1/payments/gepg/control-numbers/:controlNumber --------------------
app.get('/control-numbers/:controlNumber', authMiddleware, async (c) => {
  const controlNumber = c.req.param('controlNumber');
  const billId = c.req.query('billId');
  if (!billId) {
    return c.json(
      { success: false, error: { code: 'MISSING_BILL_ID', message: 'billId query required' } },
      400
    );
  }
  const provider = getProvider(c);
  try {
    const result = await provider.queryStatus({ controlNumber, billId });
    return c.json({ success: true, data: result });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'GEPG_ERROR',
      status: 502,
      fallback: 'GePG gateway error',
    });
  }
});

// --- POST /v1/payments/gepg/callback ----------------------------------------
// Signature middleware runs FIRST to capture raw body for verification.
app.post('/callback', signatureMiddleware, withSecurityEvents({ action: 'gepg.create', resource: 'gepg', severity: 'info' }, async (c) => {
  const raw = c.get('gepgRawBody') as string;
  const signature = c.get('gepgSignature') as string;

  let parsed: z.infer<typeof CallbackSchema>;
  try {
    parsed = CallbackSchema.parse(JSON.parse(raw));
  } catch (err) {
    return c.json(
      {
        success: false,
        error: { code: 'INVALID_PAYLOAD', message: 'payload parse failed' },
      },
      400
    );
  }

  const provider = getProvider(c);
  try {
    const result = await provider.handleCallback(raw, signature, parsed);
    return c.json({ success: true, data: result });
  } catch (err) {
    // HIGH-6: do NOT echo provider err.message — it leaks signature
    // internals, key-fingerprint hints, malformed-XML details. Log
    // detailed reason server-side only.
    console.warn(
      '[gepg] callback rejected:',
      err instanceof Error ? err.message : 'unknown'
    );
    return c.json(
      { success: false, error: { code: 'CALLBACK_REJECTED', message: 'callback processing failed' } },
      400
    );
  }
}));

export default app;
export const gepgRouter = app;
