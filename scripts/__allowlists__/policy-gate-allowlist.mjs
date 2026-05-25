/**
 * Policy-gate coverage allow-list (Wave-13 LITFIN-port primitive).
 *
 * Kernel call-sites that invoke a tool / power-tool / action executor
 * WITHOUT routing through `assertTierPolicy(...)`. Each entry MUST be
 * justified — the only legitimate reasons are:
 *
 *   1. The call-site IS the policy-gate implementation itself (e.g.
 *      `policy-gate.ts`, `runPolicyGate`, tier-policy resolver).
 *   2. The call-site is a deterministic bypass that the gate already
 *      delegates to (e.g. internal kernel bootstrap, killswitch refusal
 *      paths — those execute before the gate runs by design).
 *   3. The call-site is a test fixture / mock factory that builds a
 *      stub tool registry where no tier semantics apply.
 *
 * Keys are paths RELATIVE to the repo root. Empty at initial port so
 * the scanner starts at zero exemptions — every kernel mutation MUST
 * either pass through the gate or get an explicit, reviewed entry here.
 */

export const POLICY_GATE_ALLOWLIST = new Map([
  // intentionally empty — exemptions added on-demand with justifying reason.
]);
