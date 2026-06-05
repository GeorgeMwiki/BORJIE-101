/**
 * Reference fixture: monthly TRA royalty-return filing.
 *
 * Owner SOP: "On day 5 of each month at 6am, compile the previous month's
 * royalty-return batch, file it via the TRA MCP. When TRA confirms, send a
 * confirmation to each owner. If TRA rejects, ping me."
 *
 * Tools referenced:
 *   - tra.compile_royalty_return
 *   - tra.file_via_mcp
 *   - owner.notify
 */

import type { AOP } from '../../types.js';

export const traFiling: AOP = {
  name: 'monthly-tra-filing',
  version: '0.1.0',
  description: 'Compile + file the monthly royalty-return batch via the TRA MCP.',
  trigger: {
    kind: 'cron',
    schedule: '0 6 5 * *',
    timezone: 'Africa/Dar_es_Salaam',
  },
  input: {
    source: 'query',
    query: {
      table: 'royalty_returns',
      where: { period: 'previous_month' },
    },
  },
  steps: [
    {
      kind: 'tool',
      id: 'compile-batch',
      tool: 'tra.compile_royalty_return',
      args: { format: 'royalty-return-v3' },
      on_success: 'file',
      on_failure: 'notify-owner-failure',
    },
    {
      kind: 'tool',
      id: 'file',
      tool: 'tra.file_via_mcp',
      args: { dry_run: false },
      on_success: 'wait-tra',
      on_failure: 'notify-owner-failure',
    },
    {
      kind: 'monitor',
      id: 'wait-tra',
      monitor: {
        kind: 'wait',
        until_event: 'tra.acknowledged',
        OR: { kind: 'timer', duration: '24h' },
        timeout: '24h',
      },
      on_trigger: 'notify-owner-success',
    },
    {
      kind: 'tool',
      id: 'notify-owner-success',
      tool: 'owner.notify',
      args: { template: 'tra-filed-ok' },
    },
    {
      kind: 'tool',
      id: 'notify-owner-failure',
      tool: 'owner.notify',
      args: { template: 'tra-filing-failed', priority: 'high' },
    },
  ],
  entry: 'compile-batch',
};
