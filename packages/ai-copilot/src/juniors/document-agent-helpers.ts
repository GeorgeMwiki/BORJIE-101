/**
 * Pure helpers for the Document Agent — no external deps. Kept in
 * their own module so the core junior stays under the file-size budget
 * and so the helpers can be unit-tested in isolation.
 */

// Type-only import to break the cyclic edge with document-agent.ts.
// `isolatedModules` is on in tsconfig.base.json, so the `type` modifier
// is required for the import to be erased rather than emitted as a
// runtime require (which would cause an init-order issue here).
import type { ProcessPMLResult } from './document-agent.js';

/**
 * Parse Claude's response as JSON, tolerating optional markdown fences.
 * Returns a discriminated result so callers don't need to wrap in
 * try/catch.
 */
export function parseClaudeJson(raw: string):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenceMatch && fenceMatch[1] !== undefined ? fenceMatch[1] : raw).trim();
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Stable id derived from (tenantId, licenceNo) so re-ingesting the same
 * PML hits the `ON CONFLICT (id) DO NOTHING` branch instead of
 * inserting a duplicate row.
 */
export function deterministicLicenceId(tenantId: string, licenceNo: string): string {
  const hash = Buffer.from(`${tenantId}::${licenceNo}`).toString('hex');
  return `lic_${hash.slice(0, 32)}`;
}

/**
 * Stable id derived from the PDF path. Used when the caller does not
 * provide a `documentId` explicitly — gives every extraction a non-null
 * evidence reference for audit.
 */
export function deterministicEvidenceId(path: string): string {
  const hash = Buffer.from(path).toString('hex');
  return `doc_${hash.slice(0, 32)}`;
}

/**
 * Format a failure ProcessPMLResult with a prefix so callers can tell
 * which pipeline stage emitted the error.
 */
export function failure(
  error: unknown,
  evidenceIds: ReadonlyArray<string>,
  prefix: string,
): ProcessPMLResult {
  return {
    success: false,
    evidenceIds,
    error: `${prefix}: ${error instanceof Error ? error.message : String(error)}`,
  };
}
