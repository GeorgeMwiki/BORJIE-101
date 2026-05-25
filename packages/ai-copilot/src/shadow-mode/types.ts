/**
 * Shadow / dry-run mode — types.
 *
 * Wave 28 trust-builder: a tenant can enable shadow mode for any subset of
 * autonomy domains. While shadow is active, the autonomy guard SHORT-
 * CIRCUITS before execution — it records what Mr. Mwikila WOULD have done,
 * but never actually calls the downstream service. The head reviews a
 * report and compares shadow decisions to actual human decisions over the
 * period.
 *
 * Types here are immutable and independent of the autonomy module's
 * runtime classes so the module is cheap to import from the gateway
 * router.
 */
import type { AutonomyDomain } from '../autonomy/types.js';

export interface ShadowConfig {
  readonly tenantId: string;
  readonly domains: readonly AutonomyDomain[];
  readonly enabledAt: string;
  readonly disablesAt: string | null;
  readonly recordOnly: true;
}

export interface ShadowDecision {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly domain: AutonomyDomain;
  readonly wouldHaveActed: boolean;
  readonly action: string;
  readonly rationale: string;
  readonly counterfactualConfidence: number;
  readonly recordedAt: string;
  /**
   * Optional human decision to compare against. Populated when the
   * downstream service (exception inbox, approval flow) reaches back to
   * annotate what the human did.
   */
  readonly humanDecision: 'approved' | 'rejected' | null;
  readonly humanDecidedAt: string | null;
}

export interface ShadowReport {
  readonly tenantId: string;
  readonly from: string;
  readonly to: string;
  readonly totalDecisions: number;
  readonly wouldHaveActedCount: number;
  readonly byDomain: Readonly<
    Record<
      AutonomyDomain,
      Readonly<{
        total: number;
        wouldHaveActed: number;
        humanApproved: number;
        humanRejected: number;
        agreementPct: number | null;
      }>
    >
  >;
  readonly overallAgreementPct: number | null;
  readonly generatedAt: string;
}

export interface ShadowModeRepository {
  getConfig(tenantId: string): Promise<ShadowConfig | null>;
  upsertConfig(config: ShadowConfig): Promise<ShadowConfig>;
  clearDomains(tenantId: string, domains: readonly AutonomyDomain[]): Promise<ShadowConfig | null>;
  recordDecision(decision: ShadowDecision): Promise<ShadowDecision>;
  listDecisions(
    tenantId: string,
    params: { from: string; to: string },
  ): Promise<readonly ShadowDecision[]>;
}
