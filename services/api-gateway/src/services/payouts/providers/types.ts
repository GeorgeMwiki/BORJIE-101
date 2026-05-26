/**
 * Shared port + helpers used by every concrete payout adapter.
 *
 * The `PayoutProvider` shape lives in `../stub-payout-provider.ts` for
 * historical reasons (the worker imports it from there, the test suite
 * already targets that file, and we cannot move it without churn).
 * This module re-exports the alias so concrete adapters stay decoupled
 * from the stub file's filename.
 */

export type {
  PayoutProvider,
  PayoutProviderInput,
  PayoutProviderResult,
} from '../stub-payout-provider';

/**
 * Strip secret values from a string we are about to log or surface as
 * an error. We hash to `***` rather than to the secret length to avoid
 * length leaks. The caller passes any number of redaction targets;
 * each non-empty one is replaced with `***`.
 *
 * Defensive: a `PayoutProvider` may surface error messages to the
 * outbox `last_error` column, which downstream operators read. We
 * never want a leaked Daraja security credential there.
 */
export function sanitiseSecrets(message: string, secrets: ReadonlyArray<string | undefined>): string {
  const trimmed = secrets
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  if (trimmed.length === 0) return message;
  // Sort by length descending so longer secrets are redacted before
  // any prefix substring of theirs is replaced.
  const ordered = [...trimmed].sort((a, b) => b.length - a.length);
  return ordered.reduce((acc, secret) => {
    if (!acc.includes(secret)) return acc;
    return acc.split(secret).join('***');
  }, message);
}

/**
 * Validate an E.164 msisdn (digits only, optional leading `+`).
 * Mpesa B2C is permissive on the wire and accepts `2547xxxxxxxx`
 * without a `+`, but we normalise for storage clarity.
 */
export function normaliseMsisdn(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Accept `+E164` and bare digits 10-15 long.
  const m = trimmed.match(/^\+?([0-9]{10,15})$/);
  if (!m) return null;
  return m[1] ?? null;
}

/**
 * The default 15s budget for any HTTP call to a payout rail. Mpesa
 * Daraja's `b2c/v1/paymentrequest` typically resolves within a few
 * seconds, but we keep a generous ceiling to absorb tail-latency
 * without dragging the worker's per-row processing budget.
 */
export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
