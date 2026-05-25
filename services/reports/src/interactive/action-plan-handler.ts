/**
 * Action Plan Handler (NEW 17)
 *
 * Dispatches an acknowledged action plan into the correct downstream
 * side effect — creating a work order, opening an approval request, or
 * simply recording the acknowledgement.
 */

import type {
  ActionPlan,
  ActionPlanAction,
  ApprovalRequestCreator,
  WorkOrderCreator,
  ActionAckResult,
} from './types.js';

export interface ActionPlanHandlerDeps {
  readonly workOrderCreator?: WorkOrderCreator;
  readonly approvalRequestCreator?: ApprovalRequestCreator;
}

export class ActionPlanHandler {
  constructor(private readonly deps: ActionPlanHandlerDeps) {}

  async handle(input: {
    readonly tenantId: string;
    readonly acknowledgedBy: string;
    readonly plan: ActionPlan;
  }): Promise<ActionAckResult> {
    const { tenantId, acknowledgedBy, plan } = input;
    const action: ActionPlanAction = plan.action;

    switch (action.kind) {
      case 'create_work_order': {
        if (!this.deps.workOrderCreator) {
          return { ackId: '', resolution: 'acknowledged', resolutionRefId: null };
        }
        const { workOrderId } = await this.deps.workOrderCreator.create({
          tenantId,
          createdBy: acknowledgedBy,
          payload: action.payload,
        });
        return {
          ackId: '',
          resolution: 'work_order_created',
          resolutionRefId: workOrderId,
        };
      }
      case 'create_approval_request': {
        if (!this.deps.approvalRequestCreator) {
          return { ackId: '', resolution: 'acknowledged', resolutionRefId: null };
        }
        const { approvalRequestId } = await this.deps.approvalRequestCreator.create({
          tenantId,
          requesterId: acknowledgedBy,
          payload: action.payload,
        });
        return {
          ackId: '',
          resolution: 'approval_requested',
          resolutionRefId: approvalRequestId,
        };
      }
      case 'external_link':
        return {
          ackId: '',
          resolution: 'external_link_followed',
          resolutionRefId: null,
        };
      case 'acknowledge':
      default:
        return { ackId: '', resolution: 'acknowledged', resolutionRefId: null };
    }
  }
}
