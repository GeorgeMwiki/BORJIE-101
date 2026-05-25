/**
 * proactive_maintenance_alert_agent — scans work_orders history + IoT
 * anomalies (if any) and flags preventive-maintenance suggestions to the
 * property manager.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface MaintenanceSignal {
  readonly subjectId: string;
  readonly subjectType: 'property' | 'unit' | 'asset';
  readonly score: number;
  readonly rationale: string;
}

const PayloadSchema = z.object({
  minScore: z.number().min(0).max(1).default(0.6),
});

export const proactiveMaintenanceAlertAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'proactive_maintenance_alert_agent',
  title: 'Proactive Maintenance Alert',
  description:
    'Surfaces preventive-maintenance opportunities based on history + IoT.',
  trigger: {
    kind: 'cron',
    cron: '0 3 * * 2',
    description: 'Weekly Tuesday 03:00 UTC.',
  },
  guardrails: {
    autonomyDomain: 'maintenance',
    autonomyAction: 'approve_work_order',
    description:
      'Emits a suggestion (not a work-order) — runs under maintenance policy.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const predictor = ctx.services.predictiveMaintenanceScheduler as
      | {
          proposeSignals: (input: {
            tenantId: string;
            minScore: number;
          }) => Promise<readonly MaintenanceSignal[]>;
        }
      | undefined;
    const flagger = ctx.services.exceptionInbox as
      | {
          writeFlag: (input: {
            tenantId: string;
            kind: 'proactive_maintenance';
            subjectId: string;
            score: number;
            rationale: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!predictor) {
      return {
        outcome: 'no_op',
        summary: 'Predictive maintenance scheduler not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const signals = await predictor.proposeSignals({
      tenantId: ctx.tenantId,
      minScore: ctx.payload.minScore,
    });
    const affected: Array<{ kind: string; id: string }> = [];
    if (flagger) {
      for (const s of signals) {
        try {
          const f = await flagger.writeFlag({
            tenantId: ctx.tenantId,
            kind: 'proactive_maintenance',
            subjectId: s.subjectId,
            score: s.score,
            rationale: s.rationale,
          });
          affected.push({ kind: 'exception', id: f.id });
        } catch {
          /* swallow */
        }
      }
    }
    return {
      outcome: signals.length ? 'executed' : 'no_op',
      summary: `Emitted ${signals.length} maintenance suggestion(s).`,
      data: { count: signals.length, minScore: ctx.payload.minScore },
      affected,
    };
  },
};
