/**
 * Property MCP server — exposes the tenant's property registry as MCP tools.
 * Read-mostly with a couple of safe mutating tools (create/update) that
 * carry `destructiveHint: false` (they're additive, not destructive).
 */

import { z } from 'zod';
import { createMCPServer, type MCPServer, type MCPServerConfig } from '../server/server.js';
import type { AuditPort, ToolDefinition } from '../types.js';
import type { PropertyPort } from './ports.js';

export interface PropertyMCPServerConfig {
  readonly db: PropertyPort;
  readonly audit?: AuditPort;
  readonly name?: string;
}

export function createPropertyMCPServer(
  config: PropertyMCPServerConfig,
): MCPServer {
  const { db } = config;
  const tools: Array<ToolDefinition> = [
    {
      name: 'list_properties',
      description: 'List all properties for the current tenant, optionally filtered by city or free-text query.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        city: z.string().optional(),
        q: z.string().optional(),
      }),
      handler: async (args, ctx) => {
        const { city, q } = args as { city?: string; q?: string };
        const filters: { city?: string; q?: string } = {};
        if (city !== undefined) filters.city = city;
        if (q !== undefined) filters.q = q;
        const items = await db.listProperties(ctx.tenantId, filters);
        return { content: [{ type: 'text', text: JSON.stringify(items) }] };
      },
    },
    {
      name: 'get_property',
      description: 'Fetch a single property by ID.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ propertyId: z.string().uuid() }),
      handler: async (args, ctx) => {
        const { propertyId } = args as { propertyId: string };
        const out = await db.getProperty(ctx.tenantId, propertyId);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'create_property',
      description: 'Create a new property in the current tenant.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        addressLine1: z.string().min(1).max(200),
        city: z.string().min(1).max(100),
        countryCode: z.string().length(2),
      }),
      handler: async (args, ctx) => {
        const data = args as { name: string; addressLine1: string; city: string; countryCode: string };
        const out = await db.createProperty(ctx.tenantId, data);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'update_property',
      description: 'Update fields on an existing property.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      inputSchema: z.object({
        propertyId: z.string().uuid(),
        patch: z.object({
          name: z.string().min(1).max(200).optional(),
          addressLine1: z.string().min(1).max(200).optional(),
          city: z.string().min(1).max(100).optional(),
        }),
      }),
      handler: async (args, ctx) => {
        const { propertyId, patch } = args as { propertyId: string; patch: Record<string, unknown> };
        const out = await db.updateProperty(ctx.tenantId, propertyId, patch);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'list_units',
      description: 'List units for a property.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ propertyId: z.string().uuid() }),
      handler: async (args, ctx) => {
        const { propertyId } = args as { propertyId: string };
        const items = await db.listUnits(ctx.tenantId, propertyId);
        return { content: [{ type: 'text', text: JSON.stringify(items) }] };
      },
    },
    {
      name: 'list_leases',
      description: 'List leases for a unit.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ unitId: z.string().uuid() }),
      handler: async (args, ctx) => {
        const { unitId } = args as { unitId: string };
        const items = await db.listLeases(ctx.tenantId, unitId);
        return { content: [{ type: 'text', text: JSON.stringify(items) }] };
      },
    },
    {
      name: 'get_tenant_history',
      description: 'Look up a leaseholder\'s history across all their leases in this tenant.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ leaseholderId: z.string().uuid() }),
      handler: async (args, ctx) => {
        const { leaseholderId } = args as { leaseholderId: string };
        const items = await db.getTenantHistory(ctx.tenantId, leaseholderId);
        return { content: [{ type: 'text', text: JSON.stringify(items) }] };
      },
    },
  ];

  const base: MCPServerConfig = {
    name: config.name ?? 'borjie.property',
    version: '0.1.0',
    description: 'Property registry MCP server (tenant-scoped).',
    tools,
  };
  return createMCPServer(config.audit ? { ...base, audit: config.audit } : base);
}
