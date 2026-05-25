/**
 * Test helpers. Stubs for the LLM router + tool registry the AOP compiler
 * needs, plus a deterministic id generator.
 */

import type { AOP, BrainToolRegistry, LLMRouter, ToolTier } from '@borjie/aop-compiler';
import type { AutonomyValidator } from '../types.js';

export const FIXTURE_TOOLS: Record<string, ToolTier> = Object.freeze({
  // Reporting / read-side
  'reporting.weekly_brief': 'write',
  'reporting.daily_snapshot': 'write',
  'reporting.churn_digest': 'write',
  'reporting.platform_kpi_pack': 'write',
  // Arrears / lease
  'tenant.send_reminder': 'write',
  'tenant.voice_call': 'write',
  'lease.draft_renewal': 'write',
  'lease.send_to_tenant': 'write',
  'notice.draft_eviction_notice': 'destructive',
  // Compliance
  'kra.compile_mri_batch': 'read',
  'kra.file_via_mcp': 'write',
  'kra.readiness_check': 'read',
  // Owner / notify
  'owner.notify': 'write',
  // Finance
  'finance.cash_balance_check': 'read',
  // Maintenance
  'maintenance.snapshot_overnight': 'read',
});

export function buildRegistry(
  override: Record<string, ToolTier> = FIXTURE_TOOLS,
): BrainToolRegistry {
  return Object.freeze({
    has: (id: string) => Object.prototype.hasOwnProperty.call(override, id),
    tier: (id: string) => override[id],
  });
}

export function buildStubLLM(
  responses: ReadonlyArray<{ contains: string; respond: AOP | string }>,
): LLMRouter {
  return Object.freeze({
    complete: async ({ user }: { system: string; user: string }) => {
      for (const r of responses) {
        if (user.includes(r.contains)) {
          return typeof r.respond === 'string' ? r.respond : JSON.stringify(r.respond);
        }
      }
      throw new Error(`stub LLM had no response for prompt: ${user.slice(0, 80)}...`);
    },
  });
}

export function buildAllowAutonomyValidator(): AutonomyValidator {
  return Object.freeze({
    evaluate: async () => Object.freeze({ ok: true }),
  });
}

export function buildDenyAutonomyValidator(reason = 'cap exceeded'): AutonomyValidator {
  return Object.freeze({
    evaluate: async () => Object.freeze({ ok: false, reason }),
  });
}

export const fixedNow = '2026-05-19T07:00:00.000Z';
export const stableIdGenerator = (start = 0): (() => string) => {
  let i = start;
  return () => `skl_test_${(i += 1).toString().padStart(4, '0')}`;
};

/**
 * A simple fully-valid AOP for weekly-brief — used by compile-skill tests.
 */
export const WEEKLY_BRIEF_AOP: AOP = Object.freeze({
  name: 'weekly-brief',
  version: '0.1.0',
  description: 'Every Monday at 7am EAT, send the owner a one-page brief.',
  trigger: {
    kind: 'cron',
    schedule: '0 7 * * 1',
    timezone: 'Africa/Nairobi',
  },
  steps: [
    {
      kind: 'tool',
      id: 'compile-brief',
      tool: 'reporting.weekly_brief',
      args: { window: 'previous_week' },
      on_success: 'send',
    },
    {
      kind: 'tool',
      id: 'send',
      tool: 'owner.notify',
      args: { channel: 'email' },
    },
  ],
  entry: 'compile-brief',
}) as AOP;

/**
 * A conditional AOP for lease-renewal — event-triggered.
 */
export const LEASE_RENEWAL_AOP: AOP = Object.freeze({
  name: 'lease-renewal-60d',
  version: '0.1.0',
  description: '60 days before lease end, draft renewal + ask owner.',
  trigger: {
    kind: 'event',
    event: 'lease.t_minus_60d',
  },
  steps: [
    {
      kind: 'tool',
      id: 'draft',
      tool: 'lease.draft_renewal',
      args: {},
      on_success: 'ask',
    },
    {
      kind: 'hook',
      id: 'ask',
      hook: 'ask-owner',
      prompt: 'Approve sending this renewal offer?',
      on_approve: 'send',
    },
    {
      kind: 'tool',
      id: 'send',
      tool: 'lease.send_to_tenant',
      args: {},
    },
  ],
  entry: 'draft',
}) as AOP;

/**
 * An AOP that references a destructive tool guarded by an ask-owner hook
 * — should compile clean.
 */
export const ARREARS_CHASE_AOP: AOP = Object.freeze({
  name: 'arrears-chase-day-25',
  version: '0.1.0',
  description: 'Day 25 chase — draft eviction with ask-owner guard.',
  trigger: {
    kind: 'cron',
    schedule: '0 9 25 * *',
    timezone: 'Africa/Nairobi',
  },
  steps: [
    {
      kind: 'tool',
      id: 'remind',
      tool: 'tenant.send_reminder',
      args: { template: 'arrears' },
      on_success: 'wait',
    },
    {
      kind: 'monitor',
      id: 'wait',
      monitor: {
        kind: 'wait',
        until_event: 'payment.received',
        OR: { kind: 'timer', duration: '7d' },
        timeout: '7d',
      },
      on_trigger: 'ask-owner-approval',
    },
    {
      kind: 'hook',
      id: 'ask-owner-approval',
      hook: 'ask-owner',
      prompt: 'Tenant still in arrears — approve drafting eviction notice?',
      on_approve: 'draft-notice',
    },
    {
      kind: 'tool',
      id: 'draft-notice',
      tool: 'notice.draft_eviction_notice',
      args: { tone: 'formal' },
    },
  ],
  entry: 'remind',
}) as AOP;

/**
 * Same arrears AOP but WITHOUT the ask-owner guard — should be rejected
 * by the destructive-tool permission check.
 */
export const UNGUARDED_EVICTION_AOP: AOP = Object.freeze({
  name: 'unguarded-eviction',
  version: '0.1.0',
  trigger: { kind: 'cron', schedule: '0 9 25 * *', timezone: 'Africa/Nairobi' },
  steps: [
    {
      kind: 'tool',
      id: 'draft-notice',
      tool: 'notice.draft_eviction_notice',
      args: { tone: 'formal' },
    },
  ],
  entry: 'draft-notice',
}) as AOP;
