/**
 * Tool 5/9 — process_intel.get_conformance
 *
 * Token-based replay of the actual event log against a normative model
 * (either an Inductive Miner-infrequent discovery from a "happy path"
 * window, or an explicitly-supplied Petri net). Returns fitness,
 * precision, generalisation, and per-case violation breakdowns.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetConformanceInput {
  readonly tenantId: string;
  readonly processId: string;
  readonly modelSource?: 'discovered_happy_path' | 'supplied_petri_net';
  readonly petriNetPnml?: string;
  readonly since?: string;
  readonly until?: string;
}

export interface ConformanceViolation {
  readonly violationType: 'missing_token' | 'remaining_token' | 'unfit_trace';
  readonly activity: string;
  readonly caseCount: number;
}

export interface GetConformanceOutput {
  readonly processId: string;
  readonly fitness: number;
  readonly precision: number;
  readonly generalisation: number;
  readonly simplicity: number;
  readonly violations: ReadonlyArray<ConformanceViolation>;
}

export const getConformanceTool: ProcessIntelTool<GetConformanceOutput> = Object.freeze({
  name: 'process_intel.get_conformance',
  description:
    'Run token-based replay against a normative process model and return fitness, precision, generalisation, and simplicity scores in [0,1]. Top violation categories (missing/remaining tokens, unfit traces) are aggregated per-activity. Model source defaults to a discovered Inductive Miner happy-path; pass `petriNetPnml` to override.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string' },
      processId: { type: 'string' },
      modelSource: {
        type: 'string',
        enum: ['discovered_happy_path', 'supplied_petri_net'],
      },
      petriNetPnml: { type: 'string', description: 'PNML of the normative model when modelSource=supplied_petri_net' },
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
      fitness: { type: 'number' },
      precision: { type: 'number' },
      generalisation: { type: 'number' },
      simplicity: { type: 'number' },
      violations: {
        type: 'array',
        items: {
          type: 'object' as const,
          properties: {
            violationType: {
              type: 'string',
              enum: ['missing_token', 'remaining_token', 'unfit_trace'],
            },
            activity: { type: 'string' },
            caseCount: { type: 'integer' },
          },
          required: ['violationType', 'activity', 'caseCount'],
        },
      },
    },
    required: [
      'processId',
      'fitness',
      'precision',
      'generalisation',
      'simplicity',
      'violations',
    ],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetConformanceOutput> {
    const input = rawInput as GetConformanceInput;
    const response = await deps.pm4py.send('get_conformance', {
      tenantId: input.tenantId,
      processId: input.processId,
      modelSource: input.modelSource ?? 'discovered_happy_path',
      petriNetPnml: input.petriNetPnml,
      since: input.since,
      until: input.until,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_conformance failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    return (response.data ?? {
      processId: input.processId,
      fitness: 0,
      precision: 0,
      generalisation: 0,
      simplicity: 0,
      violations: [],
    }) as GetConformanceOutput;
  },
});
