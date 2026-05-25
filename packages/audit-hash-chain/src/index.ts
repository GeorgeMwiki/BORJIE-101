/**
 * `@borjie/audit-hash-chain` — public surface.
 *
 * Hash-chain audit primitive ported from LITFIN (PO-14). Pure
 * functions for canonical JSON, sha256/hmac row hashing, chain
 * append, tamper-evident verification, and secret rotation.
 *
 * No I/O, no DB. The caller persists the entries however they like —
 * Supabase, SQLite, JSON file, Trillian. Verification is also pure,
 * so a cron job can pull the chain and recompute.
 */

export { canonicalJson } from "./canonical-json.js";
export {
  chainHash,
  hashChainEntry,
  appendEntry,
  verifyChain,
} from "./chain.js";
export {
  GENESIS_HASH,
  type AuditPayload,
  type ChainEntry,
  type ChainVerificationResult,
  type SecretRing,
} from "./types.js";
