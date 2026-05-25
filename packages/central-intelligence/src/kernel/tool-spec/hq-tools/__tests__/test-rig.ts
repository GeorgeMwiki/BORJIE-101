/**
 * Shared test fixtures for HQ-tool tests.
 *
 * - In-memory OTel recorder
 * - In-memory sovereign-ledger sink
 * - HqToolContext builder with canned scopes
 */

import type {
  HqCallerScopes,
  HqOtelSpanRecorder,
  HqSovereignLedgerSink,
  HqToolContext,
  RiskTier,
} from '../../../risk-tier.js';

export interface CapturedSpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
  readonly errorMessage?: string | null;
}

export interface CapturedSovereignRow {
  readonly toolName: string;
  readonly riskTier: RiskTier;
  readonly callerId: string;
  readonly tenantId: string | null;
  readonly inputJson: string;
  readonly outputJson: string | null;
  readonly approvalRequired: boolean;
  readonly approvalRecordId: string | null;
  readonly costEstimateUsd: number | null;
  readonly at: string;
}

export interface InMemoryOtelRecorder extends HqOtelSpanRecorder {
  spans: CapturedSpan[];
}

export function makeInMemoryOtel(): InMemoryOtelRecorder {
  const spans: CapturedSpan[] = [];
  return {
    spans,
    recordSpan(args) {
      spans.push({
        name: args.name,
        attributes: { ...args.attributes },
        durationMs: args.durationMs,
        status: args.status,
        errorMessage: args.errorMessage ?? null,
      });
    },
  };
}

export interface InMemorySovereignLedger extends HqSovereignLedgerSink {
  rows: CapturedSovereignRow[];
}

export function makeInMemorySovereignLedger(): InMemorySovereignLedger {
  const rows: CapturedSovereignRow[] = [];
  return {
    rows,
    async recordSovereignAction(row) {
      rows.push({ ...row });
    },
  };
}

export interface BuildCtxArgs {
  readonly scopes?: ReadonlyArray<string>;
  readonly callerId?: string;
  readonly approvalRecordId?: string | null;
  readonly otel?: HqOtelSpanRecorder | null;
  readonly sovereignLedger?: HqSovereignLedgerSink | null;
  readonly nowMs?: number;
}

export const PLATFORM_ADMIN_SCOPES: ReadonlyArray<string> = Object.freeze([
  'platform:*',
]);

export const TENANT_SCOPED_SCOPES = (tenantId: string): ReadonlyArray<string> =>
  Object.freeze([`tenant:${tenantId}`, `tenant:${tenantId}:*`]);

export function buildCaller(args: BuildCtxArgs): HqCallerScopes {
  return {
    callerId: args.callerId ?? 'admin-user-1',
    scopes: args.scopes ?? PLATFORM_ADMIN_SCOPES,
  };
}

export function buildCtx(args: BuildCtxArgs = {}): HqToolContext {
  const fixedNow = args.nowMs ?? Date.parse('2026-05-15T09:00:00.000Z');
  let calls = 0;
  return {
    caller: buildCaller(args),
    approvalRecordId: args.approvalRecordId ?? null,
    otel: args.otel ?? null,
    sovereignLedger: args.sovereignLedger ?? null,
    // Deterministic clock: each clock() call advances 10ms so the
    // span captures a non-zero duration without relying on real time.
    clock: () => new Date(fixedNow + calls++ * 10),
  };
}
