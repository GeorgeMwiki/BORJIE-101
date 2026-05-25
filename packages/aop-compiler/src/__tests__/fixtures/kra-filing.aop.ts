/**
 * Reference fixture: monthly KRA MRI filing.
 *
 * Owner SOP: "On day 5 of each month at 6am, compile the previous month's
 * MRI batch, file it via the KRA MCP. When KRA confirms, send a confirmation
 * to each owner. If KRA rejects, ping me."
 *
 * Tools referenced:
 *   - kra.compile_mri_batch
 *   - kra.file_via_mcp
 *   - owner.notify
 */

import type { AOP } from '../../types.js';

export const kraFiling: AOP = {
  name: 'monthly-kra-filing',
  version: '0.1.0',
  description: 'Compile + file the monthly MRI batch via the KRA MCP.',
  trigger: {
    kind: 'cron',
    schedule: '0 6 5 * *',
    timezone: 'Africa/Nairobi',
  },
  input: {
    source: 'query',
    query: {
      table: 'rent_receipts',
      where: { period: 'previous_month' },
    },
  },
  steps: [
    {
      kind: 'tool',
      id: 'compile-batch',
      tool: 'kra.compile_mri_batch',
      args: { format: 'mri-v3' },
      on_success: 'file',
      on_failure: 'notify-owner-failure',
    },
    {
      kind: 'tool',
      id: 'file',
      tool: 'kra.file_via_mcp',
      args: { dry_run: false },
      on_success: 'wait-kra',
      on_failure: 'notify-owner-failure',
    },
    {
      kind: 'monitor',
      id: 'wait-kra',
      monitor: {
        kind: 'wait',
        until_event: 'kra.acknowledged',
        OR: { kind: 'timer', duration: '24h' },
        timeout: '24h',
      },
      on_trigger: 'notify-owner-success',
    },
    {
      kind: 'tool',
      id: 'notify-owner-success',
      tool: 'owner.notify',
      args: { template: 'kra-filed-ok' },
    },
    {
      kind: 'tool',
      id: 'notify-owner-failure',
      tool: 'owner.notify',
      args: { template: 'kra-filing-failed', priority: 'high' },
    },
  ],
  entry: 'compile-batch',
};
