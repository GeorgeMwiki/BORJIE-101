/**
 * Shared test fixtures for owner-tier tool tests.
 *
 * Reuses the HQ in-memory OTel recorder & context shape so the
 * telemetry assertions look identical across families.
 */

import type {
  HqCallerScopes,
  HqOtelSpanRecorder,
  HqToolContext,
} from '../../../risk-tier.js';

export interface CapturedSpan {
  readonly name: string;
  readonly attributes: Readonly<
    Record<string, string | number | boolean | null>
  >;
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
  readonly errorMessage?: string | null;
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

export interface BuildOwnerCtxArgs {
  readonly tenantId?: string;
  readonly scopes?: ReadonlyArray<string>;
  readonly callerId?: string;
  readonly otel?: HqOtelSpanRecorder | null;
  readonly nowMs?: number;
}

export const DEFAULT_TENANT_ID = 'tenant-alpha';
export const DEFAULT_OWNER_CALLER_ID = 'owner-user-1';

export function ownerScopesFor(tenantId: string): ReadonlyArray<string> {
  return Object.freeze([
    `tenant:${tenantId}`,
    `tenant:${tenantId}:owner`,
    `tenant:${tenantId}:arrears:read`,
  ]);
}

export function buildOwnerCaller(args: BuildOwnerCtxArgs = {}): HqCallerScopes {
  const tenantId = args.tenantId ?? DEFAULT_TENANT_ID;
  return {
    callerId: args.callerId ?? DEFAULT_OWNER_CALLER_ID,
    scopes: args.scopes ?? ownerScopesFor(tenantId),
  };
}

export function buildOwnerCtx(args: BuildOwnerCtxArgs = {}): HqToolContext {
  const fixedNow = args.nowMs ?? Date.parse('2026-05-15T09:00:00.000Z');
  let calls = 0;
  return {
    caller: buildOwnerCaller(args),
    approvalRecordId: null,
    otel: args.otel ?? null,
    sovereignLedger: null,
    clock: () => new Date(fixedNow + calls++ * 10),
  };
}
