/**
 * Tamper-evident hash chain for SEC-4 audit rows.
 *
 * Every persisted record (PromptInjectionAttempt, ToolUseViolation,
 * OutputFilterBlock, AgentSecuritySignal, RedTeamRun) carries an
 * `audit_hash`. Promotion-relevant rows also carry `prev_hash`.
 *
 * Implementation note: we deliberately stick to a deterministic
 * SHA-256 over a canonical key=value, sorted-key serialisation so that
 * forensic replay during incident response can be done by hand from
 * raw row contents.
 */
import { createHash } from 'node:crypto';

const GENESIS_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Genesis hash used as `prev_hash` for the first row in a chain.
 */
export function genesisHash(): string {
  return GENESIS_HASH;
}

function canonicalSerialize(input: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(input).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = input[key];
    parts.push(`${key}=${stringifyValue(value)}`);
  }
  return parts.join('|');
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => stringifyValue(v)).join(',');
  }
  if (typeof value === 'object') {
    return canonicalSerialize(value as Record<string, unknown>);
  }
  return String(value);
}

/**
 * Compute a SHA-256 over the deterministic canonical serialisation,
 * mixing in the previous hash so any tamper invalidates the chain.
 */
export function chainHash(
  prev: string,
  fields: Readonly<Record<string, unknown>>,
): string {
  const payload = `${prev}::${canonicalSerialize(fields)}`;
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Stand-alone hash for non-chained rows.
 */
export function rowHash(fields: Readonly<Record<string, unknown>>): string {
  return chainHash(GENESIS_HASH, fields);
}
