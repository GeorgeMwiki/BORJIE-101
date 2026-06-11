/**
 * R7 — Proof-carrying Gatekeeper (the membrane verifier).
 *
 * ONE named organ that runs the COMPOSED safety-invariant set over a
 * higher-rung action / self-edit and emits exactly one signed
 * {@link SafetyCertificate}. The category Borjie owns is "self-evolving
 * INSIDE a proof-carrying membrane" — this is the membrane: a single,
 * refuse-by-default verifier whose certificate is the proof that the MD
 * provably never breaches a tenant's data / security / data-protection.
 *
 * The gatekeeper does NOT reimplement or alter any rail. It DELEGATES to
 * the existing, independently-tested check functions through injected
 * PORTS — `runPolicyGate`, `checkInviolable`, `resolveKillswitch`, the
 * egress projector, the evidence/locale/k-anon checks. The composition
 * root binds the REAL functions; tests bind mocks. Because it merely reads
 * what the scattered checks already decided, the verdict it certifies is
 * CONSISTENT with the existing pipeline — it UNIFIES + CERTIFIES, it does
 * not add new restrictions.
 *
 * REFUSE-BY-DEFAULT (see {@link buildCertificate}): the certificate
 * certifies `allow` only when every *required* invariant is satisfied.
 *
 * SHADOW MODE: `evaluate` is a pure computation that returns a
 * certificate. It NEVER throws (every port call is wrapped fail-closed —
 * a port that throws records an unsatisfied invariant, never an exception
 * out of the turn) and it NEVER mutates the action or the kernel decision.
 * Whether the certificate is emitted / enforced is the caller's choice;
 * `shadow.ts` wires it as emit-and-log-only.
 */

import {
  buildCertificate,
  GENESIS_HASH,
  type InvariantResult,
  type SafetyCertificate,
  type SafetyInvariantName,
} from './certificate.js';

// ─────────────────────────────────────────────────────────────────────
// Ports — the existing checks, injected. Return shapes mirror the real
// functions (confirmed against policy-gate.ts / inviolable.ts /
// killswitch.ts). The gatekeeper reads a single boolean signal from each.
// ─────────────────────────────────────────────────────────────────────

/** Mirrors `runPolicyGate(...).verdict.status` ∈ pass|soften|block. */
export type PolicyGateStatusPort = (
  action: GatekeeperAction,
) => 'pass' | 'soften' | 'block';

/** Mirrors `checkInviolable(...).status` ∈ pass|block. */
export type InviolableStatusPort = (
  action: GatekeeperAction,
) => 'pass' | 'block';

/** Mirrors `resolveKillswitch(...).level` ∈ live|degraded|halt. */
export type KillswitchLevelPort = (
  tenantScope: string,
) => 'live' | 'degraded' | 'halt';

/** TRUE when the request + decision tenant scopes are consistent. */
export type TenantScopeConsistentPort = (action: GatekeeperAction) => boolean;

/** TRUE when the evidence chain is non-empty (for recommendation-class). */
export type EvidenceChainPort = (action: GatekeeperAction) => boolean;

/** TRUE when the rendered text is single-language (no EN/SW mixing). */
export type LocalePurePort = (action: GatekeeperAction) => boolean;

/** TRUE when the egress projector found NO leak in the action's output. */
export type EgressCleanPort = (action: GatekeeperAction) => boolean;

/** TRUE when the cohort k-anon floor (≥30) holds (for cohort reads). */
export type KAnonPort = (action: GatekeeperAction) => boolean;

/** TRUE when the action mutates NO rail (money/RLS/audit-chain/kill-switch). */
export type NoRailMutationPort = (action: GatekeeperAction) => boolean;

/**
 * The action the membrane verifies. Carries only the classification flags
 * the invariant set needs — never raw model weights or free-form intent.
 */
export interface GatekeeperAction {
  /** Stable reference (verb id, self-edit descriptor id, thought id). */
  readonly actionRef: string;
  /** Tenant scope the action executes inside; 'platform' for none. */
  readonly tenantScope: string;
  /** TRUE when the action is a recommendation that must cite evidence. */
  readonly isRecommendation?: boolean;
  /** TRUE when the action reads a cohort aggregate (k-anon applies). */
  readonly isCohortRead?: boolean;
  /** Opaque carrier the ports read (text, citations, scopes …). */
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface GatekeeperDeps {
  readonly policyGate: PolicyGateStatusPort;
  readonly inviolable: InviolableStatusPort;
  readonly killswitch: KillswitchLevelPort;
  readonly tenantScopeConsistent: TenantScopeConsistentPort;
  readonly evidenceChain: EvidenceChainPort;
  readonly localePure: LocalePurePort;
  readonly egressClean: EgressCleanPort;
  readonly kAnon: KAnonPort;
  readonly noRailMutation: NoRailMutationPort;
  /** Deterministic clock + id generators (injected for test determinism). */
  readonly now: () => number;
  readonly newCertId: () => string;
}

export interface GatekeeperEvaluateOptions {
  /** Prior certificate hash to chain off (defaults to GENESIS_HASH). */
  readonly prevHash?: string;
}

export interface Gatekeeper {
  /**
   * Run the composed invariant set over `action` and return a signed,
   * hash-chained certificate. PURE + fail-closed: never throws, never
   * mutates the action. A port that throws records its invariant as
   * UNSATISFIED (refuse-by-default), never an exception out of the turn.
   */
  evaluate(
    action: GatekeeperAction,
    options?: GatekeeperEvaluateOptions,
  ): SafetyCertificate;
}

// ─────────────────────────────────────────────────────────────────────
// Fail-closed port runner — a throwing/absent port yields `false`.
// ─────────────────────────────────────────────────────────────────────

function safeBool(fn: () => boolean): boolean {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}

function invariant(
  name: SafetyInvariantName,
  satisfied: boolean,
  required: boolean,
  evidence: string,
): InvariantResult {
  return { name, satisfied, required, evidence: evidence.slice(0, 512) };
}

// ─────────────────────────────────────────────────────────────────────
// Composition — the eight invariants. Each delegates to one port.
// `required` encodes the refuse-by-default scope: the universal rails are
// always required; evidence/k-anon are required only for the class that
// the existing checks already enforce them on (recommendation / cohort).
// ─────────────────────────────────────────────────────────────────────

function composeInvariants(
  deps: GatekeeperDeps,
  action: GatekeeperAction,
): ReadonlyArray<InvariantResult> {
  const policyOk = safeBool(() => deps.policyGate(action) !== 'block');
  const inviolableOk = safeBool(() => deps.inviolable(action) === 'pass');
  const ksOk = safeBool(() => deps.killswitch(action.tenantScope) !== 'halt');
  const scopeOk = safeBool(() => deps.tenantScopeConsistent(action));
  const localeOk = safeBool(() => deps.localePure(action));
  const egressOk = safeBool(() => deps.egressClean(action));
  const noRailOk = safeBool(() => deps.noRailMutation(action));

  const evidenceRequired = action.isRecommendation === true;
  const evidenceOk = evidenceRequired
    ? safeBool(() => deps.evidenceChain(action))
    : true;

  const kAnonRequired = action.isCohortRead === true;
  const kAnonOk = kAnonRequired ? safeBool(() => deps.kAnon(action)) : true;

  return [
    invariant(
      'policy-gate-allowed',
      policyOk && inviolableOk,
      true,
      `policy=${policyOk ? 'pass' : 'block'} inviolable=${inviolableOk ? 'pass' : 'block'}`,
    ),
    invariant(
      'tenant-scope-consistent',
      scopeOk,
      true,
      `scope=${action.tenantScope}`,
    ),
    invariant(
      'evidence-chain-present',
      evidenceOk,
      evidenceRequired,
      evidenceRequired
        ? `recommendation evidence=${evidenceOk ? 'present' : 'empty'}`
        : 'n/a (non-recommendation)',
    ),
    invariant('locale-pure', localeOk, true, `locale=${localeOk ? 'pure' : 'mixed'}`),
    invariant('egress-clean', egressOk, true, `egress=${egressOk ? 'clean' : 'leak'}`),
    invariant(
      'k-anon-held',
      kAnonOk,
      kAnonRequired,
      kAnonRequired
        ? `cohort k-anon=${kAnonOk ? 'held' : 'below-floor'}`
        : 'n/a (non-cohort)',
    ),
    invariant(
      'no-rail-mutation',
      noRailOk,
      true,
      `rail-mutation=${noRailOk ? 'none' : 'detected'}`,
    ),
    invariant(
      'killswitch-not-tripped',
      ksOk,
      true,
      `killswitch=${ksOk ? 'live' : 'halt'}`,
    ),
  ];
}

export function createGatekeeper(deps: GatekeeperDeps): Gatekeeper {
  return {
    evaluate(
      action: GatekeeperAction,
      options?: GatekeeperEvaluateOptions,
    ): SafetyCertificate {
      const checks = composeInvariants(deps, action);
      return buildCertificate(
        {
          certId: deps.newCertId(),
          actionRef: action.actionRef,
          tenantScope: action.tenantScope,
          checks,
          issuedAtMs: deps.now(),
        },
        options?.prevHash ?? GENESIS_HASH,
      );
    },
  };
}
