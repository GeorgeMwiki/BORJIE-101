/**
 * ETag computation. Resources are hashed via canonical JSON + sha256
 * (re-using `canonicalJson` from audit-hash-chain so the format is
 * shared with the LITFIN-port chain).
 *
 * ETag format: `W/"<hex-prefix>"` — weak validator, 16 hex chars (8
 * bytes) of sha256. Weak because two semantically-equal resources
 * with different JSON whitespace would otherwise produce different
 * ETags — but canonicalJson eliminates that source of mismatch, so
 * "weak" here is a label, not behavioural.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "@borjie/audit-hash-chain";

const ETAG_PREFIX_BYTES = 8;

export function etag(resource: unknown): string {
  const canon = canonicalJson(resource);
  const hash = createHash("sha256").update(canon).digest("hex");
  return `W/"${hash.slice(0, ETAG_PREFIX_BYTES * 2)}"`;
}

/**
 * RFC-7232: clients SHOULD strip the weak prefix when comparing.
 * We accept either form on the wire and normalise to the weak form.
 */
export function normaliseETag(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "*") return "*";
  if (trimmed.startsWith('W/')) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return `W/${trimmed}`;
  return `W/"${trimmed}"`;
}

export function etagMatches(provided: string, current: string): boolean {
  const a = normaliseETag(provided);
  const b = normaliseETag(current);
  if (a === "*") return true;
  return a === b;
}
