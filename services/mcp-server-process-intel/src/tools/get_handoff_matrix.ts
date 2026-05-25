/**
 * Tool 7/9 — process_intel.get_handoff_matrix
 *
 * Computes the resource-to-resource handoff network (social network of
 * work in pm4py terminology). The matrix `M[from][to]` counts how many
 * times resource `from` immediately preceded resource `to` in a case.
 * Optionally returns betweenness / degree centrality for each resource
 * to flag bottleneck-people.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetHandoffMatrixInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly since?: string;
  readonly until?: string;
  readonly includeCentrality?: boolean;
}

export interface HandoffEntry {
  readonly fromResource: string;
  readonly toResource: string;
  readonly handoffCount: number;
  readonly avgWaitSeconds: number;
}

export interface ResourceCentrality {
  readonly resource: string;
  readonly degreeCentrality: number;
  readonly betweennessCentrality: number;
}

export interface GetHandoffMatrixOutput {
  readonly processId: string;
  readonly handoffs: ReadonlyArray<HandoffEntry>;
  readonly centrality: ReadonlyArray<ResourceCentrality>;
}

export const getHandoffMatrixTool: ProcessIntelTool<GetHandoffMatrixOutput> = Object.freeze({
  name: 'process_intel.get_handoff_matrix',
  description:
    'Build the resource handoff matrix for a process. Each entry counts how often resource A passed work to resource B, with average wait between their respective events. Set `includeCentrality: true` to also receive degree and betweenness centrality per resource.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      since: { type: 'string', format: 'date-time' },
      until: { type: 'string', format: 'date-time' },
      includeCentrality: { type: 'boolean' },
    },
    required: ['tenantId', 'processId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: {
      processId: { type: 'string' },
      handoffs: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            fromResource: { type: 'string' },
            toResource: { type: 'string' },
            handoffCount: { type: 'integer' },
            avgWaitSeconds: { type: 'number' },
          },
          required: ['fromResource', 'toResource', 'handoffCount', 'avgWaitSeconds'],
        },
      },
      centrality: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            resource: { type: 'string' },
            degreeCentrality: { type: 'number' },
            betweennessCentrality: { type: 'number' },
          },
          required: ['resource', 'degreeCentrality', 'betweennessCentrality'],
        },
      },
    },
    required: ['processId', 'handoffs', 'centrality'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetHandoffMatrixOutput> {
    const input = rawInput as GetHandoffMatrixInput;
    const response = await deps.pm4py.send('get_handoff_matrix', {
      tenantId: input.tenantId,
      processId: input.processId,
      since: input.since,
      until: input.until,
      includeCentrality: input.includeCentrality ?? false,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_handoff_matrix failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      handoffs: [],
      centrality: [],
    }) as GetHandoffMatrixOutput;
  },
});
