/**
 * SCHEDULE_FIELD_VISIT step handler.
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type SchedulingPort } from './ports.js';

export function makeScheduleFieldVisitHandler(
  port: SchedulingPort,
): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const entityId = String(step.payload['entityId'] ?? '');
    const scheduledForRaw = step.payload['scheduledFor'];
    if (!entityId || typeof scheduledForRaw !== 'string') {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'schedule_field_visit: entityId and scheduledFor are required',
        },
      };
    }
    const scheduledFor = new Date(scheduledForRaw);
    if (Number.isNaN(scheduledFor.getTime())) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'schedule_field_visit: scheduledFor must be a valid date',
        },
      };
    }
    const assigneeUserId =
      typeof step.payload['assigneeUserId'] === 'string'
        ? (step.payload['assigneeUserId'] as string)
        : null;
    const notes = String(step.payload['notes'] ?? '');
    try {
      const result = await port.scheduleFieldVisit({
        tenantId: ctx.tenantId,
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
        entityId,
        scheduledFor,
        assigneeUserId,
        notes,
      });
      return {
        status: 'SUCCEEDED',
        resultPayload: { visitId: result.visitId },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'SCHEDULE_VISIT_ERROR',
          message:
            err instanceof Error ? err.message : 'schedule_field_visit failed',
        },
      };
    }
  };
}

export const scheduleFieldVisitHandler = (): never => {
  throw new Error(
    'scheduleFieldVisitHandler must be built via makeScheduleFieldVisitHandler',
  );
};
