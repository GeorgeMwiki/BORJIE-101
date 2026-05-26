/**
 * tenant-scrubber — Pino-compatible log redactor that flags and
 * strips cross-tenant identifiers from log entries. Reads the
 * active TenantContext (if any) and:
 *   1. Adds `tenantId` to every log entry that lacks one.
 *   2. If a log entry references a `tenantId` that differs from
 *      the bound context, the entry is rewritten:
 *        - `tenantId` is replaced with `'[REDACTED:CROSS-TENANT]'`
 *        - a sibling field `_isolationViolation` is added.
 *   3. Returns a Pino-shaped `redact` config that callers can
 *      merge into their pino instance.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { tryGetTenantContext } from '../context/tenant-context.js';

const TENANT_ID_KEYS = ['tenantId', 'tenant_id', 'tenantID'] as const;

const TENANT_ID_RX =
  /^[A-Za-z0-9_-]{6,64}$/;

export interface ScrubbedEntry {
  readonly tenantId?: string;
  readonly _isolationViolation?: {
    readonly observedTenantId: string;
    readonly contextTenantId: string;
    readonly kind: 'cross-tenant-log';
  };
  [key: string]: unknown;
}

/**
 * Scrub a single log entry. Pure — does not write anywhere. The
 * caller installs this as a Pino `formatters.log` function.
 */
export function scrubLogEntry(
  entry: Record<string, unknown>,
): ScrubbedEntry {
  const ctx = tryGetTenantContext();
  const out: Record<string, unknown> = { ...entry };

  let observed: string | undefined;
  for (const k of TENANT_ID_KEYS) {
    const v = entry[k];
    if (typeof v === 'string' && TENANT_ID_RX.test(v)) {
      observed = v;
      break;
    }
  }

  if (ctx && observed && observed !== ctx.tenantId) {
    for (const k of TENANT_ID_KEYS) {
      if (k in out) out[k] = '[REDACTED:CROSS-TENANT]';
    }
    out._isolationViolation = {
      observedTenantId: observed,
      contextTenantId: ctx.tenantId,
      kind: 'cross-tenant-log',
    };
    return out as ScrubbedEntry;
  }

  if (ctx && !observed) {
    out.tenantId = ctx.tenantId;
  }

  return out as ScrubbedEntry;
}

/**
 * Recursively walk a log object and scrub any nested tenant-id
 * leaks. Used in tests + the Pino `formatters` hook.
 */
export function deepScrubLogEntry(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const top = scrubLogEntry(entry);
  const out: Record<string, unknown> = { ...top };
  for (const [k, v] of Object.entries(top)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepScrubLogEntry(v as Record<string, unknown>);
    }
  }
  return out;
}

/**
 * Returns a Pino redact configuration that pairs with the
 * scrubber. The `paths` enumerate the structured fields we never
 * allow through unscrubbed.
 */
export function tenantScrubberRedactPaths(): ReadonlyArray<string> {
  return [
    'req.headers.cookie',
    'req.headers.authorization',
    '*.password',
    '*.token',
    '*.secret',
    '*.apiKey',
    // Cross-tenant ids are scrubbed by the formatter, but we also
    // hard-redact a few well-known sensitive shapes here so a
    // misconfigured logger still does not leak them.
    'observed_tenant_id_unauthorised',
    'cross_tenant_payload',
  ];
}
