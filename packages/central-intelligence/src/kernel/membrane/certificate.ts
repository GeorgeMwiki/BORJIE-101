/**
 * R7 — Safety Certificate (the proof object).
 *
 * The membrane's unit of proof. EVERY higher-rung action / self-edit that
 * passes through the {@link createGatekeeper} verifier produces exactly one
 * `SafetyCertificate`: a signed, hash-chained, append-only record naming the
 * action, the tenant scope it executed inside, the result of EACH composed
 * invariant, and a REFUSE-BY-DEFAULT verdict.
 *
 * This file is PURE — no I/O, no DB, no LLM, no env reads. The chain hash is
 * computed with the SAME primitive the rest of the platform's audit chains
 * use (`@borjie/audit-hash-chain` — sha256/hmac over canonical JSON), so a
 * certificate row is verifiable by the very same `verifyChain` walk that the
 * sovereign / handoff / conversation-audit chains already use. We do NOT add
 * a crypto dependency; `chainHash` + `GENESIS_HASH` already ship.
 *
 * REFUSE-BY-DEFAULT is the keystone property: `buildCertificate` returns
 * `verdict: 'allow'` ONLY when EVERY *required* invariant is `satisfied`.
 * Any required invariant that is unsatisfied — or absent — flips the verdict
 * to `'refuse'`. The membrane never opens on omission.
 *
 * IMPORTANT (shadow mode): emitting a certificate does NOT, by itself,
 * enforce anything. The certificate is a *witness*. The kernel's existing
 * scattered checks remain the sole deciders until a later validated wave
 * flips the gatekeeper to enforce. See `gatekeeper.ts` for the composition.
 */

import { z } from 'zod';
import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';

// ─────────────────────────────────────────────────────────────────────
// Invariant catalogue — the named rails the membrane certifies over.
// Each maps to an existing, independently-tested kernel check; the
// membrane DELEGATES to that check (see gatekeeper.ts) and records its
// boolean result here. Names are stable strings (audit-readable).
// ─────────────────────────────────────────────────────────────────────

export const SAFETY_INVARIANT_NAMES = [
  'policy-gate-allowed',
  'tenant-scope-consistent',
  'evidence-chain-present',
  'locale-pure',
  'egress-clean',
  'k-anon-held',
  'no-rail-mutation',
  'killswitch-not-tripped',
] as const;

export type SafetyInvariantName = (typeof SAFETY_INVARIANT_NAMES)[number];

/**
 * Per-invariant result. `required` marks whether this invariant must be
 * satisfied for an `allow` verdict — a non-required invariant (e.g.
 * k-anon for a non-cohort read) records its status for the audit trail
 * but never blocks. `evidence` is a short, redaction-safe string the
 * Auditor can read (rule id, scope ids, count) — NEVER raw model prose.
 */
export const InvariantResultSchema = z
  .object({
    name: z.enum(SAFETY_INVARIANT_NAMES),
    satisfied: z.boolean(),
    required: z.boolean(),
    evidence: z.string().max(512),
  })
  .strict();

export type InvariantResult = z.infer<typeof InvariantResultSchema>;

export const SafetyVerdictSchema = z.enum(['allow', 'refuse']);
export type SafetyVerdict = z.infer<typeof SafetyVerdictSchema>;

/**
 * The signed, hash-chained certificate row. `hash` chains off `priorHash`
 * exactly like every other Borjie audit chain — so a cron `verifyChain`
 * over the certificate stream is tamper-evident for free.
 */
export const SafetyCertificateSchema = z
  .object({
    certId: z.string().min(1),
    /** Stable reference to the action / self-edit being certified. */
    actionRef: z.string().min(1),
    /** The tenant scope the action executed inside ('platform' for none). */
    tenantScope: z.string().min(1),
    invariantResults: z.array(InvariantResultSchema).min(1),
    verdict: SafetyVerdictSchema,
    issuedAtMs: z.number().int().nonnegative(),
    priorHash: z.string().min(1),
    hash: z.string().min(1),
  })
  .strict();

export type SafetyCertificate = z.infer<typeof SafetyCertificateSchema>;

// ─────────────────────────────────────────────────────────────────────
// Pure builder
// ─────────────────────────────────────────────────────────────────────

export interface BuildCertificateInput {
  readonly certId: string;
  readonly actionRef: string;
  readonly tenantScope: string;
  readonly checks: ReadonlyArray<InvariantResult>;
  readonly issuedAtMs: number;
}

/**
 * REFUSE-BY-DEFAULT: a certificate certifies `allow` ONLY when EVERY
 * required invariant is satisfied. An empty required set is treated
 * conservatively as a refuse (nothing was proven, so nothing is allowed).
 */
export function computeVerdict(
  checks: ReadonlyArray<InvariantResult>,
): SafetyVerdict {
  const required = checks.filter((c) => c.required);
  if (required.length === 0) return 'refuse';
  return required.every((c) => c.satisfied) ? 'allow' : 'refuse';
}

/**
 * Build a signed, hash-chained certificate. PURE. The verdict is computed
 * refuse-by-default over `checks`; the chain hash is the sha256 of the
 * canonical-JSON body chained off `prevHash` using the platform's shared
 * `chainHash` primitive (NO new crypto dep). Pass `GENESIS_HASH` for the
 * first certificate in a chain (re-exported below for callers).
 */
export function buildCertificate(
  input: BuildCertificateInput,
  prevHash: string,
): SafetyCertificate {
  const verdict = computeVerdict(input.checks);
  const priorHash = prevHash.length > 0 ? prevHash : GENESIS_HASH;
  // The hashed body is the full certificate MINUS the hash itself — so the
  // hash commits to every field (verdict, scope, each invariant result) and
  // to the prior link, making any post-hoc edit detectable.
  const body = {
    certId: input.certId,
    actionRef: input.actionRef,
    tenantScope: input.tenantScope,
    invariantResults: input.checks,
    verdict,
    issuedAtMs: input.issuedAtMs,
  };
  const hash = chainHash({ prev: priorHash, payload: body });
  return {
    ...body,
    invariantResults: [...input.checks],
    priorHash,
    hash,
  };
}

export { GENESIS_HASH };
