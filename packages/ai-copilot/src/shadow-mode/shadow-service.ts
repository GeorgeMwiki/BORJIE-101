/**
 * ShadowService — manages per-tenant shadow / dry-run mode.
 *
 * Responsibilities:
 *   - enable / disable shadow mode for a (tenant, domain-set)
 *   - record shadow decisions that the autonomy guard captured
 *   - generate a report comparing shadow vs human decisions for a window
 *
 * The service is a thin coordinator over a `ShadowModeRepository`. An
 * in-memory repo ships for tests + degraded-mode deployments; prod wires
 * a Postgres-backed repo.
 */
import { randomUUID } from 'node:crypto';
import type { AutonomyDomain } from '../autonomy/types.js';
import type {
  ShadowConfig,
  ShadowDecision,
  ShadowModeRepository,
  ShadowReport,
} from './types.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ShadowServiceDeps {
  readonly repository: ShadowModeRepository;
  readonly clock?: () => Date;
}

export class ShadowService {
  constructor(private readonly deps: ShadowServiceDeps) {}

  /** Turn on shadow mode for the given domains for `durationDays`. */
  async enable(
    tenantId: string,
    domains: readonly AutonomyDomain[],
    durationDays: number | null,
  ): Promise<ShadowConfig> {
    const now = this.now();
    const existing = await this.deps.repository.getConfig(tenantId);
    const mergedDomains = Array.from(
      new Set<AutonomyDomain>([...(existing?.domains ?? []), ...domains]),
    );
    const disablesAt =
      durationDays && durationDays > 0
        ? new Date(now.getTime() + durationDays * 24 * 3_600_000).toISOString()
        : null;
    const config: ShadowConfig = {
      tenantId,
      domains: mergedDomains,
      enabledAt: existing?.enabledAt ?? now.toISOString(),
      disablesAt,
      recordOnly: true,
    };
    return this.deps.repository.upsertConfig(config);
  }

  /** Remove shadow-mode coverage for the given domains. If nothing left, the
   *  config is removed entirely (repo returns null in that case). */
  async disable(
    tenantId: string,
    domains: readonly AutonomyDomain[],
  ): Promise<ShadowConfig | null> {
    return this.deps.repository.clearDomains(tenantId, domains);
  }

  /** Read-through for the gateway router's GET /status endpoint. */
  async getStatus(tenantId: string): Promise<ShadowConfig | null> {
    const cfg = await this.deps.repository.getConfig(tenantId);
    if (!cfg) return null;
    if (cfg.disablesAt && new Date(cfg.disablesAt).getTime() <= this.now().getTime()) {
      // Auto-expire: remove and return null.
      await this.deps.repository.clearDomains(tenantId, cfg.domains);
      return null;
    }
    return cfg;
  }

  /** Check whether a (tenant, domain) pair is currently shadow-only. */
  async isShadow(tenantId: string, domain: AutonomyDomain): Promise<boolean> {
    const cfg = await this.getStatus(tenantId);
    if (!cfg) return false;
    return cfg.domains.includes(domain);
  }

  /** Record a shadow decision. Called by the autonomy guard hook and by
   *  the proactive-loop orchestrator when it short-circuits. */
  async recordDecision(input: Omit<ShadowDecision, 'decisionId' | 'recordedAt'>): Promise<ShadowDecision> {
    const decision: ShadowDecision = {
      ...input,
      decisionId: this.freshDecisionId(),
      recordedAt: this.now().toISOString(),
    };
    return this.deps.repository.recordDecision(decision);
  }

  /** Roll up shadow decisions vs human decisions for the window. */
  async generateReport(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<ShadowReport> {
    const decisions = await this.deps.repository.listDecisions(tenantId, { from, to });
    const byDomain: Record<string, { total: number; wouldHaveActed: number; humanApproved: number; humanRejected: number }> = {};
    let totalActed = 0;
    let totalDecidedByHuman = 0;
    let totalAgreements = 0;

    for (const d of decisions) {
      const bucket = byDomain[d.domain] ?? { total: 0, wouldHaveActed: 0, humanApproved: 0, humanRejected: 0 };
      byDomain[d.domain] = {
        total: bucket.total + 1,
        wouldHaveActed: bucket.wouldHaveActed + (d.wouldHaveActed ? 1 : 0),
        humanApproved: bucket.humanApproved + (d.humanDecision === 'approved' ? 1 : 0),
        humanRejected: bucket.humanRejected + (d.humanDecision === 'rejected' ? 1 : 0),
      };
      if (d.wouldHaveActed) totalActed += 1;
      if (d.humanDecision) {
        totalDecidedByHuman += 1;
        // Agreement = AI would-act AND human approved, OR AI would-not-act AND human rejected.
        const agreement =
          (d.wouldHaveActed && d.humanDecision === 'approved') ||
          (!d.wouldHaveActed && d.humanDecision === 'rejected');
        if (agreement) totalAgreements += 1;
      }
    }

    const finalBuckets: ShadowReport['byDomain'] = Object.fromEntries(
      Object.entries(byDomain).map(([k, v]) => {
        const humanDecided = v.humanApproved + v.humanRejected;
        const agreementPct = humanDecided === 0 ? null : computeDomainAgreement(v);
        return [
          k,
          {
            total: v.total,
            wouldHaveActed: v.wouldHaveActed,
            humanApproved: v.humanApproved,
            humanRejected: v.humanRejected,
            agreementPct,
          },
        ];
      }),
    ) as ShadowReport['byDomain'];

    return {
      tenantId,
      from,
      to,
      totalDecisions: decisions.length,
      wouldHaveActedCount: totalActed,
      byDomain: finalBuckets,
      overallAgreementPct: totalDecidedByHuman === 0 ? null : totalAgreements / totalDecidedByHuman,
      generatedAt: this.now().toISOString(),
    };
  }

  private now(): Date {
    return this.deps.clock?.() ?? new Date();
  }

  private freshDecisionId(): string {
    try {
      return `shd_${randomUUID()}`;
    } catch {
      return `shd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }
}

function computeDomainAgreement(v: {
  wouldHaveActed: number;
  humanApproved: number;
  humanRejected: number;
  total: number;
}): number {
  const humanDecided = v.humanApproved + v.humanRejected;
  if (humanDecided === 0) return 0;
  // We cannot compute per-row agreement without row-level data here, so
  // approximate: min(wouldHaveActed, humanApproved) + min((total-wouldHaveActed), humanRejected).
  const wouldNotAct = v.total - v.wouldHaveActed;
  const agreements = Math.min(v.wouldHaveActed, v.humanApproved) + Math.min(wouldNotAct, v.humanRejected);
  return agreements / humanDecided;
}

// ---------------------------------------------------------------------------
// In-memory repository (tests + degraded mode)
// ---------------------------------------------------------------------------

export class InMemoryShadowModeRepository implements ShadowModeRepository {
  private configs = new Map<string, ShadowConfig>();
  private decisions: ShadowDecision[] = [];

  async getConfig(tenantId: string): Promise<ShadowConfig | null> {
    return this.configs.get(tenantId) ?? null;
  }

  async upsertConfig(config: ShadowConfig): Promise<ShadowConfig> {
    this.configs.set(config.tenantId, config);
    return config;
  }

  async clearDomains(
    tenantId: string,
    domains: readonly AutonomyDomain[],
  ): Promise<ShadowConfig | null> {
    const existing = this.configs.get(tenantId);
    if (!existing) return null;
    const remaining = existing.domains.filter((d) => !domains.includes(d));
    if (remaining.length === 0) {
      this.configs.delete(tenantId);
      return null;
    }
    const next: ShadowConfig = { ...existing, domains: remaining };
    this.configs.set(tenantId, next);
    return next;
  }

  async recordDecision(decision: ShadowDecision): Promise<ShadowDecision> {
    this.decisions = [...this.decisions, decision];
    return decision;
  }

  async listDecisions(
    tenantId: string,
    params: { from: string; to: string },
  ): Promise<readonly ShadowDecision[]> {
    return this.decisions.filter(
      (d) =>
        d.tenantId === tenantId &&
        d.recordedAt >= params.from &&
        d.recordedAt <= params.to,
    );
  }
}
