/**
 * Geo / knowledge-graph MCP server — parcel + segment lookups.
 */

import { z } from 'zod';
import { createMCPServer, type MCPServer, type MCPServerConfig } from '../server/server.js';
import type { AuditPort, ToolDefinition } from '../types.js';
import type { GeoPort } from './ports.js';

export interface GeoMCPServerConfig {
  readonly kg: GeoPort;
  readonly audit?: AuditPort;
  readonly name?: string;
}

export function createGeoMCPServer(config: GeoMCPServerConfig): MCPServer {
  const { kg } = config;
  const segmentKindEnum = z.enum(['street', 'district', 'block']);
  const tools: Array<ToolDefinition> = [
    {
      name: 'find_nearest_parcels',
      description: 'Find the parcels nearest to a lat/lng point.',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      inputSchema: z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      handler: async (args, ctx) => {
        const { lat, lng, limit } = args as { lat: number; lng: number; limit?: number };
        const out = await kg.findNearestParcels(ctx.tenantId, { lat, lng }, limit);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'get_parcel_history',
      description: 'Fetch a parcel + its historical events.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ parcelId: z.string().uuid() }),
      handler: async (args, ctx) => {
        const { parcelId } = args as { parcelId: string };
        const out = await kg.getParcelHistory(ctx.tenantId, parcelId);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'list_segments',
      description: 'List spatial segments (streets, districts, blocks) for the tenant.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ kind: segmentKindEnum.optional() }),
      handler: async (args, ctx) => {
        const { kind } = args as { kind?: 'street' | 'district' | 'block' };
        const out = await kg.listSegments(ctx.tenantId, kind);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
  ];

  const base: MCPServerConfig = {
    name: config.name ?? 'borjie.geo',
    version: '0.1.0',
    description: 'Geo / knowledge-graph MCP server (tenant-scoped).',
    tools,
  };
  return createMCPServer(config.audit ? { ...base, audit: config.audit } : base);
}
