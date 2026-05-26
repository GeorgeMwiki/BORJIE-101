/**
 * move_out_notice_agent — when a move_out_date is recorded, schedules an
 * exit inspection via the inspections service + emits the MoveOut
 * checklist.
 *
 * NOTE: MoveOutChecklistService is being wired by Z3; when the bag doesn't
 * carry `moveOutChecklistService` the agent falls back to the inspection
 * schedule path only, with a follow-up flag surfaced in the data envelope.
 */
import { z } from 'zod';
import type { TaskAgent, AgentRunResult } from '../types.js';

const PayloadSchema = z.object({
  leaseId: z.string().min(1),
  moveOutDate: z.string().min(1),
  unitId: z.string().min(1),
  propertyId: z.string().min(1),
});

export const moveOutNoticeAgent: TaskAgent<typeof PayloadSchema> = {
  id: 'move_out_notice_agent',
  title: 'Move-Out Notice Handler',
  description:
    'On move-out recording, schedules exit inspection + emits checklist.',
  trigger: {
    kind: 'event',
    eventType: 'LeaseMoveOutRecorded',
    description: 'Fires when a lease records a move_out_date.',
  },
  guardrails: {
    autonomyDomain: 'leasing',
    autonomyAction: 'approve_application',
    description: 'Sanity-gates scheduling under leasing domain rules.',
    invokesLLM: false,
  },
  payloadSchema: PayloadSchema,
  async execute(ctx): Promise<AgentRunResult> {
    const inspectionService = ctx.services.inspectionService as
      | {
          scheduleInspection: (input: {
            tenantId: string;
            leaseId: string;
            unitId: string;
            propertyId: string;
            scheduledFor: string;
            kind: 'move_out' | 'routine' | 'move_in';
            createdBy: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;
    const checklistService = ctx.services.moveOutChecklistService as
      | {
          emitChecklist: (input: {
            tenantId: string;
            leaseId: string;
            unitId: string;
          }) => Promise<{ id: string }>;
        }
      | undefined;

    const affected: Array<{ kind: string; id: string }> = [];
    const notes: string[] = [];

    if (inspectionService) {
      try {
        const res = await inspectionService.scheduleInspection({
          tenantId: ctx.tenantId,
          leaseId: ctx.payload.leaseId,
          unitId: ctx.payload.unitId,
          propertyId: ctx.payload.propertyId,
          scheduledFor: ctx.payload.moveOutDate,
          kind: 'move_out',
          createdBy: `agent:${ctx.agentId}`,
        });
        affected.push({ kind: 'inspection', id: res.id });
        notes.push('inspection_scheduled');
      } catch (err) {
        notes.push(`inspection_error:${(err as Error).message}`);
      }
    } else {
      notes.push('inspection_service_missing');
    }

    if (checklistService) {
      try {
        const res = await checklistService.emitChecklist({
          tenantId: ctx.tenantId,
          leaseId: ctx.payload.leaseId,
          unitId: ctx.payload.unitId,
        });
        affected.push({ kind: 'move_out_checklist', id: res.id });
        notes.push('checklist_emitted');
      } catch (err) {
        notes.push(`checklist_error:${(err as Error).message}`);
      }
    } else {
      // Follow-up (#33): Z3 MoveOutChecklistService wiring — fall back to notes-only.
      notes.push('move_out_checklist_service_pending_z3_wiring');
    }

    return {
      outcome: affected.length ? 'executed' : 'no_op',
      summary: `Move-out pipeline produced ${affected.length} artefact(s).`,
      data: { notes },
      affected,
    };
  },
};
