/**
 * Tool 3/9 — process_intel.get_variants_with_metrics
 *
 * Returns the distinct trace variants for a process, each with its
 * frequency (case count + share) and cycle-time stats (mean, p50, p95
 * duration in seconds). Variants are the de-duplicated activity
 * sequences pm4py extracts from the case log.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetVariantsInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly since?: string;
  readonly until?: string;
  readonly topK?: number;
}

export interface VariantMetrics {
  readonly variantId: string;
  readonly activities: ReadonlyArray<string>;
  readonly caseCount: number;
  readonly sharePercent: number;
  readonly meanDurationSeconds: number;
  readonly p50DurationSeconds: number;
  readonly p95DurationSeconds: number;
}

export interface GetVariantsOutput {
  readonly processId: string;
  readonly variants: ReadonlyArray<VariantMetrics>;
  readonly totalCases: number;
}

export const getVariantsWithMetricsTool: ProcessIntelTool<GetVariantsOutput> = Object.freeze({
  name: 'process_intel.get_variants_with_metrics',
  description:
    'List the trace variants of a process. Each variant is an ordered activity sequence; entries include case count, percentage share, and mean/p50/p95 cycle-time in seconds. Returns the top-K variants by frequency (default 20).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      since: { type: 'string', format: 'date-time' },
      until: { type: 'string', format: 'date-time' },
      topK: { type: 'integer', minimum: 1, maximum: 500 },
    },
    required: ['tenantId', 'processId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: {
      processId: { type: 'string' },
      totalCases: { type: 'integer' },
      variants: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            variantId: { type: 'string' },
            activities: { type: 'array', items: { type: 'string' } },
            caseCount: { type: 'integer' },
            sharePercent: { type: 'number' },
            meanDurationSeconds: { type: 'number' },
            p50DurationSeconds: { type: 'number' },
            p95DurationSeconds: { type: 'number' },
          },
          required: [
            'variantId',
            'activities',
            'caseCount',
            'sharePercent',
            'meanDurationSeconds',
            'p50DurationSeconds',
            'p95DurationSeconds',
          ],
        },
      },
    },
    required: ['processId', 'totalCases', 'variants'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetVariantsOutput> {
    const input = rawInput as GetVariantsInput;
    const response = await deps.pm4py.send('get_variants_with_metrics', {
      tenantId: input.tenantId,
      processId: input.processId,
      since: input.since,
      until: input.until,
      topK: input.topK ?? 20,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_variants_with_metrics failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      variants: [],
      totalCases: 0,
    }) as GetVariantsOutput;
  },
});
