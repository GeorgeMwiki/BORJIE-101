/**
 * Tool 6/9 — process_intel.get_loop_analysis
 *
 * Detects rework / loop patterns: self-loops (A→A), short loops (A→B→A),
 * and long-distance repetitions where the same activity recurs in a
 * single case. Returns frequency, average loop length, and the cases
 * most affected. Useful for spotting "we keep redoing X" patterns the
 * junior process analyst would catch.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetLoopAnalysisInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly minOccurrences?: number;
  readonly since?: string;
  readonly until?: string;
}

export interface LoopPattern {
  readonly patternType: 'self_loop' | 'short_loop' | 'long_loop';
  readonly activities: ReadonlyArray<string>;
  readonly occurrenceCount: number;
  readonly affectedCaseCount: number;
  readonly avgIterations: number;
  readonly avgExtraWaitSeconds: number;
}

export interface GetLoopAnalysisOutput {
  readonly processId: string;
  readonly patterns: ReadonlyArray<LoopPattern>;
}

export const getLoopAnalysisTool: ProcessIntelTool<GetLoopAnalysisOutput> = Object.freeze({
  name: 'process_intel.get_loop_analysis',
  description:
    'Detect rework loops in the process: self-loops, short A->B->A cycles, and longer cyclical patterns. Each pattern reports occurrence count, distinct cases affected, average iterations per case, and the average extra wait the loop adds in seconds.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      minOccurrences: {
        type: 'integer',
        minimum: 1,
        description: 'Suppress patterns occurring fewer times than this (default 3)',
      },
      since: { type: 'string', format: 'date-time' },
      until: { type: 'string', format: 'date-time' },
    },
    required: ['tenantId', 'processId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: {
      processId: { type: 'string' },
      patterns: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            patternType: {
              type: 'string',
              enum: ['self_loop', 'short_loop', 'long_loop'],
            },
            activities: { type: 'array', items: { type: 'string' } },
            occurrenceCount: { type: 'integer' },
            affectedCaseCount: { type: 'integer' },
            avgIterations: { type: 'number' },
            avgExtraWaitSeconds: { type: 'number' },
          },
          required: [
            'patternType',
            'activities',
            'occurrenceCount',
            'affectedCaseCount',
            'avgIterations',
            'avgExtraWaitSeconds',
          ],
        },
      },
    },
    required: ['processId', 'patterns'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetLoopAnalysisOutput> {
    const input = rawInput as GetLoopAnalysisInput;
    const response = await deps.pm4py.send('get_loop_analysis', {
      tenantId: input.tenantId,
      processId: input.processId,
      minOccurrences: input.minOccurrences ?? 3,
      since: input.since,
      until: input.until,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_loop_analysis failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      patterns: [],
    }) as GetLoopAnalysisOutput;
  },
});
