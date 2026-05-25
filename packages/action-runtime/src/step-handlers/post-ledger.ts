/**
 * POST_LEDGER step handler.
 *
 * The ONLY money mutation path. Calls into LedgerService.postJournalEntry
 * via the injected port. Compensation = reversing entry posted by the
 * compensation registry (NEVER mutate ledger rows).
 *
 * Payload shape:
 *   lines:           array of { accountId, direction, amountMinorUnits, currency, description }
 *   effectiveDate:   ISO timestamp; defaults to now
 *   description:     free-form (for the audit chain)
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type LedgerPort } from './ports.js';

interface LedgerLine {
  readonly accountId: string;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly description: string;
}

function validateLines(input: unknown): LedgerLine[] | null {
  if (!Array.isArray(input)) return null;
  const lines: LedgerLine[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const accountId = obj['accountId'];
    const direction = obj['direction'];
    const amountMinorUnits = obj['amountMinorUnits'];
    const currency = obj['currency'];
    const description = obj['description'];
    if (
      typeof accountId !== 'string' ||
      typeof direction !== 'string' ||
      (direction !== 'DEBIT' && direction !== 'CREDIT') ||
      typeof amountMinorUnits !== 'number' ||
      typeof currency !== 'string' ||
      currency.length !== 3 ||
      typeof description !== 'string'
    ) {
      return null;
    }
    lines.push({
      accountId,
      direction,
      amountMinorUnits,
      currency,
      description,
    });
  }
  return lines;
}

export function makePostLedgerHandler(port: LedgerPort): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const lines = validateLines(step.payload['lines']);
    if (!lines || lines.length === 0) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'post_ledger: lines is required (non-empty array)',
        },
      };
    }

    const effectiveDateRaw = step.payload['effectiveDate'];
    const effectiveDate =
      typeof effectiveDateRaw === 'string'
        ? new Date(effectiveDateRaw)
        : new Date();

    const metadata =
      (step.payload['metadata'] as Record<string, unknown> | undefined) ??
      undefined;

    try {
      const result = await port.postJournal({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        lines,
        effectiveDate,
        ...(metadata ? { metadata } : {}),
        createdBy: `persona:${ctx.personaId}`,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: {
          journalId: result.journalId,
          entryIds: result.entryIds,
        },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'LEDGER_POST_ERROR',
          message: err instanceof Error ? err.message : 'post_ledger failed',
        },
      };
    }
  };
}

export const postLedgerHandler = (): never => {
  throw new Error('postLedgerHandler must be built via makePostLedgerHandler');
};
