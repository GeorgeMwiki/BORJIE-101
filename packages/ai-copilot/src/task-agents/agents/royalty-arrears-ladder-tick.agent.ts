/**
 * arrears_ladder_tick_agent — thin wrapper around the existing outstanding royalties
 * ladder background task (`arrears_ladder_tick` in background-intelligence).
 *
 * Already exists as a scheduled task — wrapping it here lets operators
 * invoke it via the uniform task-agents surface (manual `run` + audit log
 * of ladder advances). We intentionally DO NOT re-implement the ladder.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

const PayloadSchema = z.object({
  /** When true, run the ladder even if no cases seem due (force-tick). */
  force: z.boolean().default(false),
});

export const royaltyArrearsLadderTickAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'royalty_arrears_ladder_tick_agent',
  title: 'Royalty-royalty-outstanding royalties ladder Tick',
  description:
    'Advances the royalty-outstanding royalties ladder for overdue cases; wraps the background task.',
  trigger: { kind: 'cron', cron: '0 6 * * *', description: 'Daily 06:00 UTC.' },
  guardrails: {
    autonomyDomain: 'finance',
    autonomyAction: 'act_on_arrears',
    description:
      'Gated on finance.escalateArrearsAboveMinorUnits — above the cap the ladder escalates instead.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const ladder = ctx.services.arrearsLadderTick as
      | ((input: {
          tenantId: string;
          now: Date;
          force: boolean;
        }) => Promise<{
          advanced: number;
          escalated: number;
          caseIds: readonly string[];
        }>)
      | undefined;

    if (!ladder) {
      return {
        outcome: 'no_op',
        summary: 'royalty-outstanding royalties ladder task not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const res = await ladder({
      tenantId: ctx.tenantId,
      now: ctx.now,
      force: ctx.payload.force,
    });

    return {
      outcome: res.advanced + res.escalated > 0 ? 'executed' : 'no_op',
      summary: `Advanced ${res.advanced}, escalated ${res.escalated} outstanding-royalty case(s).`,
      data: { advanced: res.advanced, escalated: res.escalated },
      affected: res.caseIds.map((id) => ({ kind: 'arrears_case', id })),
    };
  },
};
