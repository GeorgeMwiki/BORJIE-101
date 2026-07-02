/**
 * Audit-chain integrity METRIC + alert hook.
 *
 * The offline verifier (`offline-chain-verify.ts`) produces a verdict but does
 * not, by itself, make a tamper event OBSERVABLE. This module is the missing
 * operationalization: it emits an OTel counter whenever a chain is verified —
 * `audit_chain_verify_total{result}` — and a dedicated failure counter
 * `audit_chain_integrity_failures_total{tenant,reason}` on a broken chain, then
 * fans the verdict to an injectable alert hook so a paging integration
 * (PagerDuty / Slack / Sentry) can wake the security team.
 *
 * Why a separate module: the metric names + alert semantics are a stable
 * contract other tracks depend on (dashboards, alert rules). Keeping them here
 * — not inline in the verifier — lets the verifier stay pure/I-O-free and lets
 * this recording layer be reused by BOTH the offline CLI path and any live
 * verify cron.
 *
 * Fail-safe: a failure to RECORD a metric or fire an alert must never mask the
 * integrity verdict. The recorder swallows sink errors (logged by the caller's
 * onError) and always returns the verdict unchanged.
 */

import { metrics, type Counter, type Meter } from '@opentelemetry/api';
import type { OfflineVerifyResult } from './offline-chain-verify.js';

/** OTel metric names — stable contract for dashboards + alert rules. */
export const AUDIT_CHAIN_VERIFY_TOTAL = 'audit_chain_verify_total';
export const AUDIT_CHAIN_INTEGRITY_FAILURES_TOTAL =
  'audit_chain_integrity_failures_total';

/**
 * Alert payload handed to the injected hook when integrity fails. Minimal +
 * PII-free (no evidence bodies) so it is safe to forward to a paging channel.
 */
export interface AuditIntegrityAlert {
  readonly tenantId: string;
  readonly reason: string;
  readonly brokenAt?: number;
  readonly detail?: string;
  readonly recomputedHead: string;
  readonly verifiedAt: string;
}

export type AuditIntegrityAlertHook = (
  alert: AuditIntegrityAlert,
) => void | Promise<void>;

export interface AuditIntegrityRecorderOptions {
  /** OTel meter; defaults to the global meter for `@borjie/observability`. */
  readonly meter?: Meter;
  /** Fired once per broken chain. Errors are swallowed (never mask verdict). */
  readonly onIntegrityFailure?: AuditIntegrityAlertHook;
  /** Called if the alert hook itself throws — for structured logging. */
  readonly onError?: (error: Error, alert: AuditIntegrityAlert) => void;
}

export interface AuditIntegrityRecorder {
  /** Record a single verify verdict. Returns the verdict unchanged. */
  record(result: OfflineVerifyResult): OfflineVerifyResult;
  /** Record a batch of verdicts (e.g. one per tenant in a cron sweep). */
  recordBatch(
    results: readonly OfflineVerifyResult[],
  ): readonly OfflineVerifyResult[];
}

/**
 * Build a recorder bound to an OTel meter + optional alert hook.
 */
export function createAuditIntegrityRecorder(
  options: AuditIntegrityRecorderOptions = {},
): AuditIntegrityRecorder {
  const meter =
    options.meter ?? metrics.getMeter('@borjie/observability', 'audit-integrity');

  const verifyTotal: Counter = meter.createCounter(AUDIT_CHAIN_VERIFY_TOTAL, {
    description:
      'Total audit-chain verifications, labelled by result (pass|fail).',
    unit: '1',
  });
  const integrityFailures: Counter = meter.createCounter(
    AUDIT_CHAIN_INTEGRITY_FAILURES_TOTAL,
    {
      description:
        'Audit-chain integrity failures (tamper / gap / head-mismatch), labelled by tenant + reason.',
      unit: '1',
    },
  );

  function fireAlert(result: OfflineVerifyResult): void {
    const hook = options.onIntegrityFailure;
    if (!hook) return;
    const alert: AuditIntegrityAlert = {
      tenantId: result.tenantId,
      reason: result.reason ?? 'unknown',
      ...(result.brokenAt !== undefined ? { brokenAt: result.brokenAt } : {}),
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
      recomputedHead: result.recomputedHead,
      verifiedAt: result.verifiedAt,
    };
    try {
      const maybe = hook(alert);
      if (maybe && typeof (maybe as Promise<void>).then === 'function') {
        (maybe as Promise<void>).catch((err: unknown) => {
          options.onError?.(
            err instanceof Error ? err : new Error(String(err)),
            alert,
          );
        });
      }
    } catch (err) {
      // Fail-safe: an alert-hook throw must never mask the integrity verdict.
      options.onError?.(
        err instanceof Error ? err : new Error(String(err)),
        alert,
      );
    }
  }

  function record(result: OfflineVerifyResult): OfflineVerifyResult {
    try {
      verifyTotal.add(1, { result: result.valid ? 'pass' : 'fail' });
      if (!result.valid) {
        integrityFailures.add(1, {
          tenant: result.tenantId || 'unknown',
          reason: result.reason ?? 'unknown',
        });
        fireAlert(result);
      }
    } catch {
      // Metric recording is best-effort; never throw from the observability leg.
    }
    return result;
  }

  return {
    record,
    recordBatch(results) {
      for (const r of results) record(r);
      return results;
    },
  };
}
