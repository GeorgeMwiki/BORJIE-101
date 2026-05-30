/**
 * Pino-compatible log scrubber. Wired into the platform logger as a
 * formatter so every emitted record is checked against the current
 * tenant context before it reaches the transport.
 *
 * Three behaviours:
 *
 *   1. If the entry carries a tenant id (`tenantId` / `tenant_id` /
 *      `tenantID`) and it matches context, the entry passes through
 *      unchanged.
 *
 *   2. If the entry carries a DIFFERENT tenant id, the field is
 *      replaced with the sentinel `[REDACTED:CROSS-TENANT]` and a
 *      `_isolationViolation` metadata block is attached so the
 *      operator can investigate. The original (offending) id is
 *      surfaced in the metadata, not the message.
 *
 *   3. If the entry has no tenant id at all, the current context's
 *      tenant id is injected — so cross-cutting log statements
 *      automatically inherit the right scope.
 *
 * Standard secrets (auth headers, JWTs, cookies) are NOT scrubbed
 * here; that lives in Pino's `redact.paths` config — see
 * `tenantScrubberRedactPaths()` below.
 *
 * Ported verbatim from @litfin/tenant-guard.
 */

import { tryGetTenantContext } from "./context";

const TENANT_FIELDS = ["tenantId", "tenant_id", "tenantID"] as const;

interface LogEntryLike {
  [k: string]: unknown;
}

interface ViolationMeta {
  readonly observedTenantId: string;
  readonly contextTenantId: string;
  readonly kind: "cross-tenant-log";
}

export function scrubLogEntry<T extends LogEntryLike>(entry: T): T {
  const ctx = tryGetTenantContext();
  if (!ctx) return entry;
  for (const field of TENANT_FIELDS) {
    if (field in entry) {
      const v = entry[field];
      if (typeof v === "string" && v !== ctx.tenantId) {
        const out: LogEntryLike = { ...entry };
        out[field] = "[REDACTED:CROSS-TENANT]";
        out._isolationViolation = {
          observedTenantId: v,
          contextTenantId: ctx.tenantId,
          kind: "cross-tenant-log",
        } satisfies ViolationMeta;
        return out as T;
      }
      return entry;
    }
  }
  return { ...entry, tenantId: ctx.tenantId } as T;
}

export function deepScrubLogEntry<T extends LogEntryLike>(entry: T): T {
  const top = scrubLogEntry(entry);
  const out: LogEntryLike = { ...top };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[key] = deepScrubLogEntry(v as LogEntryLike);
    }
  }
  return out as T;
}

/**
 * Standard set of header / cookie / token paths to redact via Pino's
 * built-in `redact.paths` mechanism. Returned as a list so the host
 * Pino config can extend it.
 */
export function tenantScrubberRedactPaths(): ReadonlyArray<string> {
  return [
    "req.headers.authorization",
    "req.headers.cookie",
    "headers.authorization",
    "headers.cookie",
    "authorization",
    "cookie",
    "access_token",
    "refresh_token",
    "id_token",
    "jwt",
    "*.password",
    "*.secret",
    "*.apiKey",
    "*.api_key",
  ];
}
