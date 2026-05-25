/**
 * Maintenance MCP server — tickets lifecycle.
 */

import { z } from 'zod';
import { createMCPServer, type MCPServer, type MCPServerConfig } from '../server/server.js';
import type { AuditPort, ToolDefinition } from '../types.js';
import type { MaintenancePort } from './ports.js';

export interface MaintenanceMCPServerConfig {
  readonly db: MaintenancePort;
  readonly audit?: AuditPort;
  readonly name?: string;
}

export function createMaintenanceMCPServer(
  config: MaintenanceMCPServerConfig,
): MCPServer {
  const { db } = config;
  const priorityEnum = z.enum(['low', 'normal', 'high', 'critical']);
  const tools: Array<ToolDefinition> = [
    {
      name: 'list_open_tickets',
      description: 'List open maintenance tickets, optionally filtered by property or priority.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        propertyId: z.string().uuid().optional(),
        priority: priorityEnum.optional(),
      }),
      handler: async (args, ctx) => {
        const { propertyId, priority } = args as { propertyId?: string; priority?: 'low' | 'normal' | 'high' | 'critical' };
        const filters: { propertyId?: string; priority?: 'low' | 'normal' | 'high' | 'critical' } = {};
        if (propertyId !== undefined) filters.propertyId = propertyId;
        if (priority !== undefined) filters.priority = priority;
        const out = await db.listOpenTickets(ctx.tenantId, filters);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'create_ticket',
      description: 'Create a new maintenance ticket.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        propertyId: z.string().uuid(),
        unitId: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(2000),
        priority: priorityEnum,
      }),
      handler: async (args, ctx) => {
        const { propertyId, unitId, title, description, priority } = args as {
          propertyId: string; unitId?: string; title: string; description: string; priority: 'low' | 'normal' | 'high' | 'critical';
        };
        const input: {
          propertyId: string;
          unitId?: string;
          title: string;
          description: string;
          priority: 'low' | 'normal' | 'high' | 'critical';
        } = { propertyId, title, description, priority };
        if (unitId !== undefined) input.unitId = unitId;
        const out = await db.createTicket(ctx.tenantId, input);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'assign_technician',
      description: 'Assign a technician to a ticket.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      inputSchema: z.object({
        ticketId: z.string().uuid(),
        technicianId: z.string().uuid(),
      }),
      handler: async (args, ctx) => {
        const { ticketId, technicianId } = args as { ticketId: string; technicianId: string };
        const out = await db.assignTechnician(ctx.tenantId, ticketId, technicianId);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'record_completion',
      description: 'Mark a ticket completed with an optional note.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        ticketId: z.string().uuid(),
        note: z.string().max(1000).optional(),
      }),
      handler: async (args, ctx) => {
        const { ticketId, note } = args as { ticketId: string; note?: string };
        const out = await db.recordCompletion(ctx.tenantId, ticketId, note);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
  ];

  const base: MCPServerConfig = {
    name: config.name ?? 'borjie.maintenance',
    version: '0.1.0',
    description: 'Maintenance ticket lifecycle MCP server (tenant-scoped).',
    tools,
  };
  return createMCPServer(config.audit ? { ...base, audit: config.audit } : base);
}
