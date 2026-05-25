/**
 * tenant_sentiment_monitor_agent — weekly scans the messaging table and
 * flags tenants with escalated negative sentiment. Uses the existing
 * sentiment analyzer service.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

interface MessageWindow {
  readonly conversationId: string;
  readonly customerId: string;
  readonly averageSentiment: number;
  readonly messageCount: number;
}

const PayloadSchema = z.object({
  windowDays: z.number().int().min(1).max(30).default(7),
  escalateBelow: z.number().min(-1).max(1).default(-0.3),
});

export const tenantSentimentMonitorAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'tenant_sentiment_monitor_agent',
  title: 'Tenant Sentiment Monitor',
  description:
    'Flags tenants whose messaging sentiment crosses the escalation threshold.',
  trigger: {
    kind: 'cron',
    cron: '0 5 * * 1',
    description: 'Weekly Monday 05:00 UTC.',
  },
  guardrails: {
    autonomyDomain: 'communications',
    autonomyAction: 'send_routine_update',
    description:
      'Runs under communications domain; flag emission is routine update.',
    // Agent itself does not call the LLM (analyzer does internally);
    // executor-level budget-guard flag stays false here.
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const analyzer = ctx.services.sentimentAnalyzer as
      | {
          scanRecentMessages: (input: {
            tenantId: string;
            windowDays: number;
          }) => Promise<readonly MessageWindow[]>;
        }
      | undefined;
    const flagger = ctx.services.exceptionInbox as
      | {
          writeFlag: (input: {
            tenantId: string;
            kind: 'negative_sentiment';
            customerId: string;
            sentiment: number;
            evidenceRef: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    if (!analyzer) {
      return {
        outcome: 'no_op',
        summary: 'Sentiment analyzer not wired.',
        data: { reason: 'missing_deps' },
        affected: [],
      };
    }

    const windows = await analyzer.scanRecentMessages({
      tenantId: ctx.tenantId,
      windowDays: ctx.payload.windowDays,
    });
    const flagged = windows.filter(
      (w) => w.averageSentiment < ctx.payload.escalateBelow,
    );
    const affected: Array<{ kind: string; id: string }> = [];
    if (flagger) {
      for (const w of flagged) {
        try {
          const f = await flagger.writeFlag({
            tenantId: ctx.tenantId,
            kind: 'negative_sentiment',
            customerId: w.customerId,
            sentiment: w.averageSentiment,
            evidenceRef: w.conversationId,
          });
          affected.push({ kind: 'exception', id: f.id });
        } catch {
          /* swallow */
        }
      }
    }
    return {
      outcome: flagged.length ? 'executed' : 'no_op',
      summary: `Scanned ${windows.length} window(s); flagged ${flagged.length}.`,
      data: {
        scanned: windows.length,
        flagged: flagged.length,
        threshold: ctx.payload.escalateBelow,
      },
      affected,
    };
  },
};
