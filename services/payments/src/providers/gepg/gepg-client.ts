/**
 * GePG HTTP client adapter
 *
 * PSP-shortcut mode (RESEARCH_ANSWERS.md Q2) is the primary path and is
 * fully wired — this client talks to the upstream PSP over REST/JSON.
 *
 * Direct-to-GePG mode is the fallback and is deferred (see
 * Docs/KNOWN_ISSUES.md#ki-006) until live sandbox credentials are
 * issued. Sandbox paths here synthesize deterministic control numbers
 * so matcher/ledger/notifications can be exercised end-to-end without
 * credentials. Production uses mutual TLS + signed XML envelopes.
 */
import { ProviderAuthError, ValidationError } from '../../common/errors';
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type {
  GepgConfig,
  GepgControlNumberRequest,
  GepgControlNumberResponse,
  GepgStatusQuery,
  GepgStatusResult,
} from './types';

const CONTROL_NUMBER_PATH = '/api/bill/request';
const STATUS_PATH = '/api/bill/status';

function assertConfig(config: GepgConfig): void {
  if (!config.sp || !config.spSysId) {
    throw new ProviderAuthError(
      'GePG config missing sp/spSysId',
      'gepg'
    );
  }
  if (!config.baseUrl) {
    throw new ProviderAuthError('GePG baseUrl not configured', 'gepg');
  }
}

function buildHeaders(config: GepgConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-GePG-SP': config.sp,
    'X-GePG-SpSysId': config.spSysId,
    'X-GePG-Mode': config.pspMode ? 'psp' : 'direct',
    Accept: 'application/json',
  };
}

export async function requestControlNumberHttp(
  config: GepgConfig,
  req: GepgControlNumberRequest
): Promise<GepgControlNumberResponse> {
  assertConfig(config);

  if (req.amount <= 0) {
    throw new ValidationError('GePG amount must be positive', 'gepg');
  }
  if (req.currency !== 'TZS' && req.currency !== 'USD') {
    throw new ValidationError(
      `GePG unsupported currency: ${req.currency}`,
      'gepg'
    );
  }

  // Follow-up KI-006 (Docs/TODO_BACKLOG.md): real GePG SOAP/REST envelope. For sandbox we
  //   synthesize a deterministic 12-digit control number so the rest of
  //   the pipeline (matcher, ledger, notifications) can be exercised
  //   end-to-end without live credentials. Blocked on live-sandbox
  //   creds. See Docs/KNOWN_ISSUES.md#ki-006.
  if (config.environment === 'sandbox') {
    const synthetic = deriveSandboxControlNumber(req.billId, req.amount);
    logger.info(
      { billId: req.billId, synthetic, provider: 'gepg' },
      'GePG sandbox: synthesized control number'
    );
    return {
      controlNumber: synthetic,
      billId: req.billId,
      status: 'issued',
      expiresAt: req.expiresAt,
      rawResponse: { sandbox: true, synthetic },
    };
  }

  const url = `${config.baseUrl}${CONTROL_NUMBER_PATH}`;

  const body = {
    sp: config.sp,
    spSysId: config.spSysId,
    billId: req.billId,
    amount: req.amount,
    currency: req.currency,
    payer: {
      name: req.payerName,
      phone: req.payerPhone,
      email: req.payerEmail,
    },
    description: req.description,
    expiresAt: req.expiresAt?.toISOString(),
    callbackUrl: `${config.callbackBaseUrl}/v1/payments/gepg/callback`,
  };

  const doFetch = async (): Promise<GepgControlNumberResponse> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `GePG control number request failed: ${response.status} ${text}`
      );
    }

    const data = (await response.json()) as {
      controlNumber: string;
      billId: string;
      status: 'issued' | 'rejected' | 'pending';
      expiresAt?: string;
    };

    return {
      controlNumber: data.controlNumber,
      billId: data.billId,
      status: data.status,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      rawResponse: data as unknown as Record<string, unknown>,
    };
  };

  try {
    return await withRetry(doFetch, { maxAttempts: 3 });
  } catch (err) {
    logger.error({ err, provider: 'gepg' }, 'GePG control number request failed');
    throw err;
  }
}

export async function queryControlNumberHttp(
  config: GepgConfig,
  query: GepgStatusQuery
): Promise<GepgStatusResult> {
  assertConfig(config);

  if (config.environment === 'sandbox') {
    // Follow-up KI-006 (Docs/TODO_BACKLOG.md): sandbox harness — returns "pending" so the
    //   reconciliation flow has something deterministic to query.
    //   Blocked on live-sandbox creds. See Docs/KNOWN_ISSUES.md#ki-006.
    return {
      controlNumber: query.controlNumber,
      billId: query.billId,
      status: 'pending',
      paidAmount: 0,
      rawResponse: { sandbox: true },
    };
  }

  const url = `${config.baseUrl}${STATUS_PATH}?cn=${encodeURIComponent(
    query.controlNumber
  )}&billId=${encodeURIComponent(query.billId)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(config),
  });

  if (!response.ok) {
    throw new Error(`GePG status query failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    status: GepgStatusResult['status'];
    paidAmount: number;
    paidAt?: string;
    pspReceiptNumber?: string;
  };

  return {
    controlNumber: query.controlNumber,
    billId: query.billId,
    status: data.status,
    paidAmount: data.paidAmount,
    paidAt: data.paidAt ? new Date(data.paidAt) : undefined,
    pspReceiptNumber: data.pspReceiptNumber,
    rawResponse: data as unknown as Record<string, unknown>,
  };
}

/**
 * Deterministic control-number generator for sandbox testing.
 * Produces a 12-digit numeric string derived from billId + amount so
 * tests can predict the value.
 */
function deriveSandboxControlNumber(billId: string, amount: number): string {
  let hash = 0;
  const input = `${billId}|${amount}`;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  const abs = Math.abs(hash);
  const padded = abs.toString().padStart(11, '0').slice(0, 11);
  return `9${padded}`;
}
