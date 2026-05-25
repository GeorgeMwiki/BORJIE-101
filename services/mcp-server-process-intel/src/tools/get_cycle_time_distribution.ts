/**
 * Tool 8/9 — process_intel.get_cycle_time_distribution
 *
 * Returns a cycle-time histogram for a process (end-to-end case duration)
 * plus summary statistics (min, mean, median, p90, p95, p99, max).
 * Histogram bins are emitted in seconds; the caller can pass `bucketCount`
 * to override the default (20 equal-width buckets).
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetCycleTimeDistributionInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly bucketCount?: number;
  readonly logScale?: boolean;
  readonly since?: string;
  readonly until?: string;
}

export interface HistogramBucket {
  readonly lowerBoundSeconds: number;
  readonly upperBoundSeconds: number;
  readonly caseCount: number;
}

export interface CycleTimeStats {
  readonly minSeconds: number;
  readonly meanSeconds: number;
  readonly medianSeconds: number;
  readonly p90Seconds: number;
  readonly p95Seconds: number;
  readonly p99Seconds: number;
  readonly maxSeconds: number;
  readonly stdDevSeconds: number;
}

export interface GetCycleTimeDistributionOutput {
  readonly processId: string;
  readonly totalCases: number;
  readonly stats: CycleTimeStats;
  readonly buckets: ReadonlyArray<HistogramBucket>;
}

export const getCycleTimeDistributionTool: ProcessIntelTool<GetCycleTimeDistributionOutput> = Object.freeze({
  name: 'process_intel.get_cycle_time_distribution',
  description:
    'Return the cycle-time distribution for a process: per-bucket case counts plus min/mean/median/p90/p95/p99/max in seconds. Use `logScale: true` for log-spaced buckets when the distribution is right-skewed.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      bucketCount: { type: 'integer', minimum: 2, maximum: 100 },
      logScale: { type: 'boolean' },
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
      totalCases: { type: 'integer' },
      stats: {
        type: 'object' as const,
        properties: {
          minSeconds: { type: 'number' },
          meanSeconds: { type: 'number' },
          medianSeconds: { type: 'number' },
          p90Seconds: { type: 'number' },
          p95Seconds: { type: 'number' },
          p99Seconds: { type: 'number' },
          maxSeconds: { type: 'number' },
          stdDevSeconds: { type: 'number' },
        },
        required: [
          'minSeconds',
          'meanSeconds',
          'medianSeconds',
          'p90Seconds',
          'p95Seconds',
          'p99Seconds',
          'maxSeconds',
          'stdDevSeconds',
        ],
      },
      buckets: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            lowerBoundSeconds: { type: 'number' },
            upperBoundSeconds: { type: 'number' },
            caseCount: { type: 'integer' },
          },
          required: ['lowerBoundSeconds', 'upperBoundSeconds', 'caseCount'],
        },
      },
    },
    required: ['processId', 'totalCases', 'stats', 'buckets'],
  },
  async execute(
    rawInput: unknown,
    deps: ToolDeps,
  ): Promise<GetCycleTimeDistributionOutput> {
    const input = rawInput as GetCycleTimeDistributionInput;
    const response = await deps.pm4py.send('get_cycle_time_distribution', {
      tenantId: input.tenantId,
      processId: input.processId,
      bucketCount: input.bucketCount ?? 20,
      logScale: input.logScale ?? false,
      since: input.since,
      until: input.until,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_cycle_time_distribution failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      totalCases: 0,
      stats: {
        minSeconds: 0,
        meanSeconds: 0,
        medianSeconds: 0,
        p90Seconds: 0,
        p95Seconds: 0,
        p99Seconds: 0,
        maxSeconds: 0,
        stdDevSeconds: 0,
      },
      buckets: [],
    }) as GetCycleTimeDistributionOutput;
  },
});
