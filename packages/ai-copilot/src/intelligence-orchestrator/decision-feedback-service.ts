/**
 * Decision Feedback Service — captures operator approvals/rejections on
 * Brain-emitted PROPOSED_ACTION and feeds them back into routing weights
 * and persona prompt hints.
 *
 * This is preference learning: the manager approves/rejects actions, and
 * future PROPOSED_ACTION risk-weighting shifts towards their demonstrated
 * tolerance.
 *
 * Storage is pluggable; default in-memory for tests. Production binds a
 * drizzle-backed repository persisting to `ai_decision_feedback`.
 *
 * @module intelligence-orchestrator/decision-feedback-service
 */

export type OperatorVerdict =
  | 'approved'
  | 'rejected'
  | 'modified'
  | 'ignored';

export interface DecisionFeedbackRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly personaId: string;
  readonly proposedAction: {
    readonly verb: string;
    readonly object: string;
    readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  };
  readonly operatorVerdict: OperatorVerdict;
  readonly reason?: string;
  readonly createdAt: string;
}

export interface DecisionFeedbackRepository {
  insert(record: DecisionFeedbackRecord): Promise<void>;
  listByTenant(
    tenantId: string,
    limit?: number,
  ): Promise<readonly DecisionFeedbackRecord[]>;
  listByPersona(
    tenantId: string,
    personaId: string,
    limit?: number,
  ): Promise<readonly DecisionFeedbackRecord[]>;
}

export class InMemoryDecisionFeedbackRepository
  implements DecisionFeedbackRepository
{
  private readonly records: DecisionFeedbackRecord[] = [];

  async insert(record: DecisionFeedbackRecord): Promise<void> {
    this.records.push(record);
  }

  async listByTenant(
    tenantId: string,
    limit: number = 100,
  ): Promise<readonly DecisionFeedbackRecord[]> {
    return this.records
      .filter((r) => r.tenantId === tenantId)
      .slice(-limit);
  }

  async listByPersona(
    tenantId: string,
    personaId: string,
    limit: number = 100,
  ): Promise<readonly DecisionFeedbackRecord[]> {
    return this.records
      .filter((r) => r.tenantId === tenantId && r.personaId === personaId)
      .slice(-limit);
  }
}

export interface OverrideStatistics {
  readonly totalDecisions: number;
  readonly approvedCount: number;
  readonly rejectedCount: number;
  readonly modifiedCount: number;
  readonly ignoredCount: number;
  readonly rejectionRate: number;
  readonly byPersona: Record<
    string,
    { approved: number; rejected: number; rejectionRate: number }
  >;
  readonly byRiskLevel: Record<string, number>;
}

export class DecisionFeedbackService {
  constructor(private readonly repo: DecisionFeedbackRepository) {}

  async processDecisionFeedback(input: {
    tenantId: string;
    turnId: string;
    personaId: string;
    proposedAction: DecisionFeedbackRecord['proposedAction'];
    operatorVerdict: OperatorVerdict;
    reason?: string;
  }): Promise<DecisionFeedbackRecord> {
    if (!input.tenantId) {
      throw new Error('decision-feedback: tenantId is required');
    }
    const record: DecisionFeedbackRecord = {
      id: `df-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      turnId: input.turnId,
      personaId: input.personaId,
      proposedAction: input.proposedAction,
      operatorVerdict: input.operatorVerdict,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };
    await this.repo.insert(record);
    return record;
  }

  async getOverrideStatistics(tenantId: string): Promise<OverrideStatistics> {
    if (!tenantId) {
      throw new Error('decision-feedback: tenantId is required');
    }
    const records = await this.repo.listByTenant(tenantId, 1000);
    const total = records.length;
    const approved = records.filter((r) => r.operatorVerdict === 'approved').length;
    const rejected = records.filter((r) => r.operatorVerdict === 'rejected').length;
    const modified = records.filter((r) => r.operatorVerdict === 'modified').length;
    const ignored = records.filter((r) => r.operatorVerdict === 'ignored').length;

    const byPersona: Record<
      string,
      { approved: number; rejected: number; rejectionRate: number }
    > = {};
    for (const r of records) {
      const bucket = byPersona[r.personaId] ?? {
        approved: 0,
        rejected: 0,
        rejectionRate: 0,
      };
      if (r.operatorVerdict === 'approved') bucket.approved += 1;
      if (r.operatorVerdict === 'rejected') bucket.rejected += 1;
      byPersona[r.personaId] = bucket;
    }
    for (const persona of Object.keys(byPersona)) {
      const bucket = byPersona[persona];
      if (bucket) {
        const totalForPersona = bucket.approved + bucket.rejected;
        bucket.rejectionRate =
          totalForPersona === 0 ? 0 : bucket.rejected / totalForPersona;
      }
    }

    const byRiskLevel: Record<string, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    for (const r of records) {
      byRiskLevel[r.proposedAction.riskLevel] =
        (byRiskLevel[r.proposedAction.riskLevel] ?? 0) + 1;
    }

    return {
      totalDecisions: total,
      approvedCount: approved,
      rejectedCount: rejected,
      modifiedCount: modified,
      ignoredCount: ignored,
      rejectionRate: total === 0 ? 0 : rejected / total,
      byPersona,
      byRiskLevel,
    };
  }

  /**
   * Compute a per-persona risk-tolerance offset (0..1) derived from historical
   * rejection rate. Higher rejection rate → nudge the floor higher so the
   * Brain requires more evidence before proposing similar actions.
   */
  async computePersonaRiskOffset(
    tenantId: string,
    personaId: string,
  ): Promise<number> {
    const records = await this.repo.listByPersona(tenantId, personaId, 200);
    if (records.length === 0) return 0;
    const rejected = records.filter((r) => r.operatorVerdict === 'rejected').length;
    return Math.min(1, rejected / records.length);
  }
}

export function createDecisionFeedbackService(
  repo: DecisionFeedbackRepository,
): DecisionFeedbackService {
  return new DecisionFeedbackService(repo);
}
