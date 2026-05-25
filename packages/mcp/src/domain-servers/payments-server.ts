/**
 * Payments MCP server — rent ledger, payment recording, arrears, late-fee
 * computation. All amounts in minor units (cents) — never floats.
 */

import { z } from 'zod';
import { createMCPServer, type MCPServer, type MCPServerConfig } from '../server/server.js';
import type { AuditPort, ToolDefinition } from '../types.js';
import type { PaymentsPort } from './ports.js';

export interface PaymentsMCPServerConfig {
  readonly db: PaymentsPort;
  readonly audit?: AuditPort;
  readonly name?: string;
}

export function createPaymentsMCPServer(
  config: PaymentsMCPServerConfig,
): MCPServer {
  const { db } = config;
  const tools: Array<ToolDefinition> = [
    {
      name: 'get_rent_ledger',
      description: 'Fetch the rent ledger for a lease, optionally bounded by a date range.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        leaseId: z.string().uuid(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      handler: async (args, ctx) => {
        const { leaseId, from, to } = args as { leaseId: string; from?: string; to?: string };
        const range: { from?: string; to?: string } = {};
        if (from !== undefined) range.from = from;
        if (to !== undefined) range.to = to;
        const items = await db.getRentLedger(ctx.tenantId, leaseId, range);
        return { content: [{ type: 'text', text: JSON.stringify(items) }] };
      },
    },
    {
      name: 'record_payment',
      description: 'Record a rent payment on a lease. Amount is in minor currency units (e.g. cents).',
      // destructiveHint:false because adding a payment is additive; never
      // idempotent because two identical payments are legitimately distinct.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        leaseId: z.string().uuid(),
        amountMinor: z.number().int().positive(),
        currency: z.string().length(3),
        date: z.string(),
        note: z.string().max(500).optional(),
      }),
      handler: async (args, ctx) => {
        const { leaseId, amountMinor, currency, date, note } = args as {
          leaseId: string; amountMinor: number; currency: string; date: string; note?: string;
        };
        const input: {
          leaseId: string;
          amountMinor: number;
          currency: string;
          date: string;
          note?: string;
        } = { leaseId, amountMinor, currency, date };
        if (note !== undefined) input.note = note;
        const out = await db.recordPayment(ctx.tenantId, input);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'list_arrears',
      description: 'List leases that are currently in arrears for this tenant.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        minDaysOverdue: z.number().int().nonnegative().optional(),
      }),
      handler: async (args, ctx) => {
        const { minDaysOverdue } = args as { minDaysOverdue?: number };
        const filters: { minDaysOverdue?: number } = {};
        if (minDaysOverdue !== undefined) filters.minDaysOverdue = minDaysOverdue;
        const out = await db.listArrears(ctx.tenantId, filters);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'compute_late_fee',
      description: 'Compute (without committing) the late fee for a lease as of a date.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        leaseId: z.string().uuid(),
        asOf: z.string().optional(),
      }),
      handler: async (args, ctx) => {
        const { leaseId, asOf } = args as { leaseId: string; asOf?: string };
        const out = await db.computeLateFee(ctx.tenantId, leaseId, asOf);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
  ];

  const base: MCPServerConfig = {
    name: config.name ?? 'borjie.payments',
    version: '0.1.0',
    description: 'Rent ledger + arrears + late-fee MCP server (tenant-scoped).',
    tools,
  };
  return createMCPServer(config.audit ? { ...base, audit: config.audit } : base);
}
