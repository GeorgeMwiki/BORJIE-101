/**
 * Tool 4/9 — process_intel.get_correlation
 *
 * Computes correlation (Pearson for numeric, Cramér's V for categorical)
 * between each case attribute and cycle time. Lets the agent reason about
 * "what drives long cases?" without manually slicing the data.
 *
 * Returns features sorted by |coefficient| desc with sample-size guard
 * (features with <30 cases are flagged `lowSample: true`).
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetCorrelationInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly target?: 'cycle_time' | 'wait_time' | 'rework_rate';
  readonly attributes?: ReadonlyArray<string>;
  readonly since?: string;
  readonly until?: string;
}

export interface CorrelationEntry {
  readonly attribute: string;
  readonly attributeType: 'numeric' | 'categorical';
  readonly coefficient: number;
  readonly pValue: number;
  readonly sampleSize: number;
  readonly lowSample: boolean;
}

export interface GetCorrelationOutput {
  readonly processId: string;
  readonly target: string;
  readonly correlations: ReadonlyArray<CorrelationEntry>;
}

export const getCorrelationTool: ProcessIntelTool<GetCorrelationOutput> = Object.freeze({
  name: 'process_intel.get_correlation',
  description:
    'Quantify which case attributes correlate with cycle time (or wait time / rework rate). Returns Pearson r for numeric attributes and Cramer V for categorical, plus p-value and sample size. Features with <30 cases are flagged `lowSample`.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      target: {
        type: 'string',
        enum: ['cycle_time', 'wait_time', 'rework_rate'],
        description: 'Which outcome metric to correlate against (default cycle_time)',
      },
      attributes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict correlation to these attributes (default all)',
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
      target: { type: 'string' },
      correlations: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            attribute: { type: 'string' },
            attributeType: { type: 'string', enum: ['numeric', 'categorical'] },
            coefficient: { type: 'number' },
            pValue: { type: 'number' },
            sampleSize: { type: 'integer' },
            lowSample: { type: 'boolean' },
          },
          required: [
            'attribute',
            'attributeType',
            'coefficient',
            'pValue',
            'sampleSize',
            'lowSample',
          ],
        },
      },
    },
    required: ['processId', 'target', 'correlations'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetCorrelationOutput> {
    const input = rawInput as GetCorrelationInput;
    const response = await deps.pm4py.send('get_correlation', {
      tenantId: input.tenantId,
      processId: input.processId,
      target: input.target ?? 'cycle_time',
      attributes: input.attributes,
      since: input.since,
      until: input.until,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_correlation failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      target: input.target ?? 'cycle_time',
      correlations: [],
    }) as GetCorrelationOutput;
  },
});
