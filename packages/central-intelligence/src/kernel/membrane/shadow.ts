/**
 * R7 — Shadow-mode wiring for the proof-carrying gatekeeper.
 *
 * The membrane's FIRST wave runs in SHADOW: it computes a
 * {@link SafetyCertificate}, EMITS it (best-effort, via an injected sink),
 * and LOGS any DIVERGENCE between its refuse-by-default verdict and the
 * decision the kernel's existing scattered checks ALREADY made — but it
 * NEVER enforces. The existing checks remain the sole deciders. A later
 * validated wave flips this to enforce once shadow telemetry proves zero
 * divergence.
 *
 * Behavior-preserving contract (CRITICAL):
 *   - `runShadowGatekeeper` returns NOTHING the kernel acts on. It takes
 *     the already-final decision outcome, certifies alongside it, and
 *     returns void. The kernel's allow/deny outcome is unchanged.
 *   - It NEVER throws (every step is fail-closed/swallowed). On any error
 *     the turn proceeds exactly as before.
 *   - It is CI-INERT: when no gatekeeper / no audit sink is wired (the
 *     stub-sensor CI path), it short-circuits to a no-op. No emission, no
 *     divergence log, no computation that can fail a test.
 *
 * The divergence signal is the whole point of shadow mode: it is the data
 * that will later justify the enforce flip. We surface it through an
 * injected, side-effect-only `onDivergence` callback (the composition root
 * binds a pino structured-log emitter; tests bind a spy). No `console.log`.
 */

import type { Gatekeeper, GatekeeperAction } from './gatekeeper.js';
import type { SafetyCertificate, SafetyVerdict } from './certificate.js';

/** The outcome the EXISTING scattered checks already decided for this turn. */
export type ExistingDecisionOutcome = 'allow' | 'refuse';

/**
 * Append-only sink for certificate rows. Host-injected; in CI / bootstrap
 * it is absent and the shadow hook no-ops. The implementation reuses the
 * platform audit chain (the row is itself hash-chained — see certificate.ts).
 * Must never throw out of the turn; the hook swallows any rejection.
 */
export interface SafetyCertificateSink {
  emit(cert: SafetyCertificate): void | Promise<void>;
  /** Latest certificate hash to chain off; GENESIS when the chain is empty. */
  headHash?(): string | undefined;
}

/** Side-effect-only divergence reporter (pino in prod, spy in tests). */
export type DivergenceReporter = (event: ShadowDivergenceEvent) => void;

export interface ShadowDivergenceEvent {
  readonly actionRef: string;
  readonly tenantScope: string;
  readonly certificateVerdict: SafetyVerdict;
  readonly existingDecision: ExistingDecisionOutcome;
  /** TRUE when the two disagree — the signal the enforce flip waits on. */
  readonly diverged: boolean;
  readonly certId: string;
  readonly certHash: string;
}

export interface ShadowGatekeeperDeps {
  /** Absent in CI / bootstrap → the whole hook no-ops (CI-inert). */
  readonly gatekeeper?: Gatekeeper;
  /** Absent in CI → certificate emission is skipped (CI-inert). */
  readonly certificateSink?: SafetyCertificateSink;
  /** Absent → divergence is computed but not reported. */
  readonly onDivergence?: DivergenceReporter;
}

export interface RunShadowGatekeeperInput {
  readonly action: GatekeeperAction;
  /** What the kernel's existing checks already decided — the ground truth. */
  readonly existingDecision: ExistingDecisionOutcome;
}

/**
 * SHADOW hook. Computes + emits a certificate and reports divergence, then
 * RETURNS — it does not, and cannot, alter the kernel's decision (it has no
 * return value the kernel reads). Fully fail-closed + CI-inert.
 *
 * This is intentionally `void`-returning so it is impossible for a caller
 * to accidentally let the gatekeeper override the existing decision in this
 * wave: there is nothing to override WITH.
 */
export function runShadowGatekeeper(
  deps: ShadowGatekeeperDeps,
  input: RunShadowGatekeeperInput,
): void {
  // CI-inert short-circuit: no gatekeeper wired → pure no-op.
  if (!deps.gatekeeper) return;

  try {
    const prevHash = safeHeadHash(deps.certificateSink);
    const cert = deps.gatekeeper.evaluate(
      input.action,
      prevHash !== undefined ? { prevHash } : undefined,
    );

    // Emit best-effort; never block / throw out of the turn.
    if (deps.certificateSink) {
      try {
        const maybe = deps.certificateSink.emit(cert);
        if (maybe && typeof (maybe as Promise<void>).then === 'function') {
          void (maybe as Promise<void>).catch(() => undefined);
        }
      } catch {
        // swallow — emission is a side-channel.
      }
    }

    // Compute + report divergence. NEVER enforce.
    if (deps.onDivergence) {
      const diverged = cert.verdict !== input.existingDecision;
      try {
        deps.onDivergence({
          actionRef: input.action.actionRef,
          tenantScope: input.action.tenantScope,
          certificateVerdict: cert.verdict,
          existingDecision: input.existingDecision,
          diverged,
          certId: cert.certId,
          certHash: cert.hash,
        });
      } catch {
        // swallow — reporting is a side-channel.
      }
    }
  } catch {
    // Any unexpected failure: the shadow hook is a side-channel and must
    // never break the turn. Proceed exactly as if it were not wired.
  }
}

function safeHeadHash(
  sink: SafetyCertificateSink | undefined,
): string | undefined {
  if (!sink || typeof sink.headHash !== 'function') return undefined;
  try {
    const h = sink.headHash();
    return typeof h === 'string' && h.length > 0 ? h : undefined;
  } catch {
    return undefined;
  }
}
