/**
 * Tool 2/9 — process_intel.get_bottleneck_analysis
 *
 * Identifies where a process slows down: which transitions have the
 * highest mean / p95 sojourn time, what fraction of cases waited there,
 * and a severity score derived from waiting-time × case-count. Backed
 * by pm4py's performance DFG using Inductive Miner-infrequent for the
 * underlying model.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetBottleneckInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly since?: string;
  readonly until?: string;
  readonly topK?: number;
}

export interface BottleneckEdge {
  readonly fromActivity: string;
  readonly toActivity: string;
  readonly meanWaitSeconds: number;
  readonly p95WaitSeconds: number;
  readonly caseCount: number;
  readonly severityScore: number;
}

export interface GetBottleneckOutput {
  readonly processId: string;
  readonly edges: ReadonlyArray<BottleneckEdge>;
}

export const getBottleneckAnalysisTool: ProcessIntelTool<GetBottleneckOutput> = Object.freeze({
  name: 'process_intel.get_bottleneck_analysis',
  description:
    'For a given process, return the top-K transitions where work waits the longest. Each edge reports mean and p95 sojourn time in seconds, the number of cases that passed through it, and a severity score (mean-wait × cases) the agent can use to prioritise interventions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      since: { type: 'string', format: 'date-time' },
      until: { type: 'string', format: 'date-time' },
      topK: {
        type: 'integer',
        description: 'How many bottleneck edges to return (default 10, max 100)',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['tenantId', 'processId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: {
      processId: { type: 'string' },
      edges: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            fromActivity: { type: 'string' },
            toActivity: { type: 'string' },
            meanWaitSeconds: { type: 'number' },
            p95WaitSeconds: { type: 'number' },
            caseCount: { type: 'integer' },
            severityScore: { type: 'number' },
          },
          required: [
            'fromActivity',
            'toActivity',
            'meanWaitSeconds',
            'p95WaitSeconds',
            'caseCount',
            'severityScore',
          ],
        },
      },
    },
    required: ['processId', 'edges'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetBottleneckOutput> {
    const input = rawInput as GetBottleneckInput;
    const response = await deps.pm4py.send('get_bottleneck_analysis', {
      tenantId: input.tenantId,
      processId: input.processId,
      since: input.since,
      until: input.until,
      topK: input.topK ?? 10,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_bottleneck_analysis failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      edges: [],
    }) as GetBottleneckOutput;
  },
});
