/**
 * Tool 9/9 — process_intel.get_drift_alerts
 *
 * Concept-drift detection across rolling windows. Splits the case log
 * into adjacent windows (default monthly) and reports significant
 * divergences in: variant distribution (Earth-Mover's distance),
 * cycle-time mean, conformance fitness, and rework rate. Each alert
 * carries a magnitude + p-value so the agent can prioritise.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetDriftAlertsInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly windowSize?: 'daily' | 'weekly' | 'monthly';
  readonly lookbackWindows?: number;
  readonly significanceLevel?: number;
}

export interface DriftAlert {
  readonly metric:
    | 'variant_distribution'
    | 'cycle_time_mean'
    | 'conformance_fitness'
    | 'rework_rate';
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly priorValue: number;
  readonly currentValue: number;
  readonly deltaPercent: number;
  readonly pValue: number;
  readonly severity: 'low' | 'medium' | 'high';
}

export interface GetDriftAlertsOutput {
  readonly processId: string;
  readonly windowSize: string;
  readonly alerts: ReadonlyArray<DriftAlert>;
}

export const getDriftAlertsTool: ProcessIntelTool<GetDriftAlertsOutput> = Object.freeze({
  name: 'process_intel.get_drift_alerts',
  description:
    'Detect concept drift across adjacent windows of the case log. Returns alerts whenever variant distribution, cycle-time mean, conformance fitness, or rework rate diverges significantly between windows. Severity is bucketed by p-value (high: p<0.001, medium: p<0.01, low: p<significanceLevel).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      windowSize: {
        type: 'string',
        enum: ['daily', 'weekly', 'monthly'],
      },
      lookbackWindows: {
        type: 'integer',
        minimum: 2,
        maximum: 60,
        description: 'How many windows to compare backward (default 6)',
      },
      significanceLevel: {
        type: 'number',
        minimum: 0.0001,
        maximum: 0.2,
        description: 'p-value threshold for surfacing an alert (default 0.05)',
      },
    },
    required: ['tenantId', 'processId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: {
      processId: { type: 'string' },
      windowSize: { type: 'string' },
      alerts: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            metric: {
              type: 'string',
              enum: [
                'variant_distribution',
                'cycle_time_mean',
                'conformance_fitness',
                'rework_rate',
              ],
            },
            windowStart: { type: 'string', format: 'date-time' },
            windowEnd: { type: 'string', format: 'date-time' },
            priorValue: { type: 'number' },
            currentValue: { type: 'number' },
            deltaPercent: { type: 'number' },
            pValue: { type: 'number' },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: [
            'metric',
            'windowStart',
            'windowEnd',
            'priorValue',
            'currentValue',
            'deltaPercent',
            'pValue',
            'severity',
          ],
        },
      },
    },
    required: ['processId', 'windowSize', 'alerts'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetDriftAlertsOutput> {
    const input = rawInput as GetDriftAlertsInput;
    const response = await deps.pm4py.send('get_drift_alerts', {
      tenantId: input.tenantId,
      processId: input.processId,
      windowSize: input.windowSize ?? 'monthly',
      lookbackWindows: input.lookbackWindows ?? 6,
      significanceLevel: input.significanceLevel ?? 0.05,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_drift_alerts failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      windowSize: input.windowSize ?? 'monthly',
      alerts: [],
    }) as GetDriftAlertsOutput;
  },
});
