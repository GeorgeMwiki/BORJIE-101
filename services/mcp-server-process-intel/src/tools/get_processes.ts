/**
 * Tool 1/9 — process_intel.get_processes
 *
 * Lists every process the analyser has events for, scoped to a tenant.
 * Mirrors the `getProcesses` grammar of Microsoft Power Automate Process
 * Mining's MCP server (Apr 2026 release): each entry carries name,
 * event count, case count, time-range, and last-update timestamp.
 */

import type { ProcessIntelTool, ToolDeps } from '../types.js';
import { Pm4pySidecarError } from '../types.js';

export interface GetProcessesInput {
  readonly tenantId: string;
  readonly since?: string;
  readonly until?: string;
}

export interface ProcessSummary {
  readonly processId: string;
  readonly name: string;
  readonly eventCount: number;
  readonly caseCount: number;
  readonly firstEvent: string;
  readonly lastEvent: string;
}

export interface GetProcessesOutput {
  readonly processes: ReadonlyArray<ProcessSummary>;
}

export const getProcessesTool: ProcessIntelTool<GetProcessesOutput> = Object.freeze({
  name: 'process_intel.get_processes',
  description:
    'List every process the analyser has data for, scoped to the caller tenant. Each entry returns processId, human name, event count, case count, first/last event timestamps. Pass `since` / `until` (ISO-8601) to filter by event time-window.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      tenantId: { type: 'string', description: 'Tenant scope' },
      since: {
        type: 'string',
        format: 'date-time',
        description: 'Only processes with events after this date',
      },
      until: {
        type: 'string',
        format: 'date-time',
        description: 'Only processes with events before this date',
      },
    },
    required: ['tenantId'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object' as const,
    properties: {
      processes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            processId: { type: 'string' },
            name: { type: 'string' },
            eventCount: { type: 'integer' },
            caseCount: { type: 'integer' },
            firstEvent: { type: 'string', format: 'date-time' },
            lastEvent: { type: 'string', format: 'date-time' },
          },
          required: [
            'processId',
            'name',
            'eventCount',
            'caseCount',
            'firstEvent',
            'lastEvent',
          ],
        },
      },
    },
    required: ['processes'],
  },
  async execute(rawInput: unknown, deps: ToolDeps): Promise<GetProcessesOutput> {
    const input = rawInput as GetProcessesInput;
    const response = await deps.pm4py.send('get_processes', {
      tenantId: input.tenantId,
      since: input.since,
      until: input.until,
    });
    if (!response.ok) {
      throw new Pm4pySidecarError(
        response.error ?? 'pm4py get_processes failed',
        response.errorCode ?? 'SIDECAR_ERROR',
      );
    }
    const data = (response.data ?? { processes: [] }) as GetProcessesOutput;
    return data;
  },
});
