/**
 * M-Pesa Reconciliation Skill
 *
 * Reconciles M-Pesa paybill/till/C2B statement rows against the Borjie
 * ledger. Produces a structured result:
 *  - matched: rows paired to a ledger expected payment
 *  - unmatched_inbound: money received but no expected payment found
 *  - unmatched_outbound: expected payments with no corresponding M-Pesa row
 *  - suspect: matches with low confidence (amount mismatch, stale, etc.)
 *
 * M-Pesa nuances handled:
 *  - Paybill vs Till numbering
 *  - Bill-ref (account number) free-text variability — tenants often misspell
 *    their unit, use old unit labels, send partial amounts, etc.
 *  - Phone-based matching fallback — customer phone in the CPG.
 *  - Stratified fuzzy match: exact acc-ref > fuzzy acc-ref > phone > amount+window
 *
 * This skill is PURE: given statement rows + a fetcher for expected payments,
 * it produces a plan. Ledger writes happen via the Orchestrator's review gate.
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

export const MpesaRowSchema = z.object({
  transactionId: z.string().min(1),
  transactionDate: z.string().min(1),
  amountKes: z.number(),
  /** 'paybill' or 'till' or 'c2b' — drives matching rules. */
  channel: z.enum(['paybill', 'till', 'c2b']),
  /** Account number / bill reference as typed by tenant — raw, not normalized. */
  accountRef: z.string().optional(),
  /** Payer phone (masked in Kenya: 2547XXXXXXXX). */
  payerPhone: z.string().optional(),
  payerName: z.string().optional(),
});

export type MpesaRow = z.infer<typeof MpesaRowSchema>;

export const ExpectedPaymentSchema = z.object({
  id: z.string().min(1),
  tenantPhone: z.string().optional(),
  tenantName: z.string().optional(),
  unitLabel: z.string().optional(),
  accountRef: z.string().optional(),
  amountKes: z.number(),
  dueDate: z.string(),
  leaseId: z.string().optional(),
});

export type ExpectedPayment = z.infer<typeof ExpectedPaymentSchema>;

export const MpesaReconcileParamsSchema = z.object({
  rows: z.array(MpesaRowSchema).max(10_000),
  expected: z.array(ExpectedPaymentSchema).max(10_000),
  /** Amount tolerance (KES) to still count as matched. Default 0. */
  amountToleranceKes: z.number().nonnegative().default(0),
  /** Window in days for amount+phone fallback matching. Default 7. */
  windowDays: z.number().int().positive().default(7),
});

export type MpesaReconcileParams = z.infer<typeof MpesaReconcileParamsSchema>;

export interface MatchedPair {
  rowId: string;
  expectedId: string;
  confidence: number;
  method: 'exact_acc' | 'fuzzy_acc' | 'phone' | 'amount_window';
  amountDeltaKes: number;
}

export interface MpesaReconcileResult {
  matched: MatchedPair[];
  suspect: MatchedPair[];
  unmatchedInbound: MpesaRow[];
  unmatchedOutbound: ExpectedPayment[];
  summary: {
    totalInboundKes: number;
    totalMatchedKes: number;
    totalSuspectKes: number;
    matchRate: number; // 0..1
  };
}

/**
 * Normalize an account reference for fuzzy matching:
 *  - uppercase
 *  - strip all non-alphanumeric
 *  - drop leading zeros
 */
export function normalizeAccountRef(raw: string | undefined): string {
  if (!raw) return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
}

/**
 * Normalize a Kenyan phone to 2547/2541XXXXXXX.
 */
export function normalizePhone(raw: string | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return '254' + digits.slice(1);
  if (digits.startsWith('7') || digits.startsWith('1')) return '254' + digits;
  return digits;
}

/**
 * Levenshtein-ratio style similarity, 0..1. Small and allocation-light.
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  const dist = dp[n];
  const maxLen = Math.max(m, n);
  return 1 - dist / maxLen;
}

export function reconcileMpesa(
  params: MpesaReconcileParams
): MpesaReconcileResult {
  const rows = params.rows.slice();
  const expected = params.expected.slice();
  const tolerance = params.amountToleranceKes;

  const matched: MatchedPair[] = [];
  const suspect: MatchedPair[] = [];
  const usedRowIds = new Set<string>();
  const usedExpectedIds = new Set<string>();

  // Pass 1: exact account-ref match
  for (const row of rows) {
    if (!row.accountRef) continue;
    const nref = normalizeAccountRef(row.accountRef);
    if (!nref) continue;
    const match = expected.find(
      (e) =>
        !usedExpectedIds.has(e.id) &&
        normalizeAccountRef(e.accountRef) === nref
    );
    if (match) {
      const delta = row.amountKes - match.amountKes;
      const isExactAmount = Math.abs(delta) <= tolerance;
      const pair: MatchedPair = {
        rowId: row.transactionId,
        expectedId: match.id,
        confidence: isExactAmount ? 0.98 : 0.75,
        method: 'exact_acc',
        amountDeltaKes: delta,
      };
      (isExactAmount ? matched : suspect).push(pair);
      usedRowIds.add(row.transactionId);
      usedExpectedIds.add(match.id);
    }
  }

  // Pass 2: fuzzy account-ref match (>= 0.85 similarity)
  for (const row of rows) {
    if (usedRowIds.has(row.transactionId)) continue;
    if (!row.accountRef) continue;
    const nref = normalizeAccountRef(row.accountRef);
    if (!nref) continue;

    let best: { e: ExpectedPayment; sim: number } | null = null;
    for (const e of expected) {
      if (usedExpectedIds.has(e.id)) continue;
      const candidates = [
        normalizeAccountRef(e.accountRef),
        normalizeAccountRef(e.unitLabel),
      ].filter(Boolean);
      for (const cand of candidates) {
        const sim = similarity(nref, cand);
        if (sim >= 0.85 && (!best || sim > best.sim)) {
          best = { e, sim };
        }
      }
    }
    if (best) {
      const delta = row.amountKes - best.e.amountKes;
      const pair: MatchedPair = {
        rowId: row.transactionId,
        expectedId: best.e.id,
        confidence: best.sim * (Math.abs(delta) <= tolerance ? 1 : 0.85),
        method: 'fuzzy_acc',
        amountDeltaKes: delta,
      };
      (pair.confidence >= 0.85 ? matched : suspect).push(pair);
      usedRowIds.add(row.transactionId);
      usedExpectedIds.add(best.e.id);
    }
  }

  // Pass 3: phone match
  for (const row of rows) {
    if (usedRowIds.has(row.transactionId)) continue;
    const nphone = normalizePhone(row.payerPhone);
    if (!nphone) continue;
    const match = expected.find(
      (e) => !usedExpectedIds.has(e.id) && normalizePhone(e.tenantPhone) === nphone
    );
    if (match) {
      const delta = row.amountKes - match.amountKes;
      const pair: MatchedPair = {
        rowId: row.transactionId,
        expectedId: match.id,
        confidence: 0.8 * (Math.abs(delta) <= tolerance ? 1 : 0.85),
        method: 'phone',
        amountDeltaKes: delta,
      };
      (pair.confidence >= 0.7 ? matched : suspect).push(pair);
      usedRowIds.add(row.transactionId);
      usedExpectedIds.add(match.id);
    }
  }

  // Pass 4: amount + date window
  const windowMs = params.windowDays * 24 * 3600_000;
  for (const row of rows) {
    if (usedRowIds.has(row.transactionId)) continue;
    const rowDate = Date.parse(row.transactionDate);
    if (isNaN(rowDate)) continue;
    const match = expected.find((e) => {
      if (usedExpectedIds.has(e.id)) return false;
      const dueDate = Date.parse(e.dueDate);
      if (isNaN(dueDate)) return false;
      return (
        Math.abs(row.amountKes - e.amountKes) <= tolerance &&
        Math.abs(rowDate - dueDate) <= windowMs
      );
    });
    if (match) {
      const delta = row.amountKes - match.amountKes;
      suspect.push({
        rowId: row.transactionId,
        expectedId: match.id,
        confidence: 0.6,
        method: 'amount_window',
        amountDeltaKes: delta,
      });
      usedRowIds.add(row.transactionId);
      usedExpectedIds.add(match.id);
    }
  }

  const unmatchedInbound = rows.filter((r) => !usedRowIds.has(r.transactionId));
  const unmatchedOutbound = expected.filter((e) => !usedExpectedIds.has(e.id));

  const totalInboundKes = rows.reduce((s, r) => s + r.amountKes, 0);
  const totalMatchedKes = matched.reduce((s, m) => {
    const row = rows.find((r) => r.transactionId === m.rowId);
    return s + (row?.amountKes ?? 0);
  }, 0);
  const totalSuspectKes = suspect.reduce((s, m) => {
    const row = rows.find((r) => r.transactionId === m.rowId);
    return s + (row?.amountKes ?? 0);
  }, 0);
  const matchRate = totalInboundKes
    ? totalMatchedKes / totalInboundKes
    : 0;

  return {
    matched,
    suspect,
    unmatchedInbound,
    unmatchedOutbound,
    summary: {
      totalInboundKes,
      totalMatchedKes,
      totalSuspectKes,
      matchRate,
    },
  };
}

/**
 * Skill wrapper exposing `reconcileMpesa` as a ToolHandler so the Orchestrator
 * dispatcher can route persona tool calls to it.
 */
export const mpesaReconcileTool: ToolHandler = {
  name: 'skill.kenya.mpesa_reconcile',
  description:
    'Reconcile an M-Pesa paybill/till/C2B statement against expected Borjie payments. Returns matched, suspect, and unmatched rows with match-rate summary.',
  parameters: {
    type: 'object',
    required: ['rows', 'expected'],
    properties: {
      rows: {
        type: 'array',
        description:
          'M-Pesa statement rows. Each row must have transactionId, transactionDate, amountKes, channel.',
        items: { type: 'object' },
      },
      expected: {
        type: 'array',
        description:
          'Expected payments from the Borjie ledger. Each must have id, amountKes, dueDate.',
        items: { type: 'object' },
      },
      amountToleranceKes: { type: 'number', default: 0 },
      windowDays: { type: 'number', default: 7 },
    },
  },
  async execute(params) {
    const parsed = MpesaReconcileParamsSchema.safeParse(params);
    if (!parsed.success) {
      return {
        ok: false,
        error: `invalid params: ${parsed.error.message}`,
      };
    }
    const result = reconcileMpesa(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `M-Pesa reconciliation: ${result.matched.length} matched, ${result.suspect.length} suspect, ${result.unmatchedInbound.length} unmatched inbound, ${result.unmatchedOutbound.length} unmatched outbound. Match rate ${(result.summary.matchRate * 100).toFixed(1)}%.`,
    };
  },
};
