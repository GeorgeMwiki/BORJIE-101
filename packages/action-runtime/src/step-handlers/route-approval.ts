/**
 * ROUTE_APPROVAL step handler.
 *
 * HITL gate. Creates an approval row in the K5 approval matrix, then
 * blocks on the saga's signal port until the approval reaches a terminal
 * status. The matrix-DSL evaluator decides which role-group is required.
 *
 * Payload shape:
 *   actionType:           the approval's action_type (e.g. 'estate.rent_post')
 *   requiredRoleGroup:    role-group whose members must approve
 *   quorum:               number of approvers needed
 *   notifyRoleGroup?:     optional pre-notify role-group
 *   timeoutMs?:           how long to wait before timing out (default 24h)
 */

import { type StepHandler, type StepHandlerResult } from './index.js';
import { type ApprovalRouterPort } from './ports.js';

const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function makeRouteApprovalHandler(
  port: ApprovalRouterPort,
): StepHandler {
  return async (step, ctx): Promise<StepHandlerResult> => {
    const actionType = String(step.payload['actionType'] ?? '');
    const requiredRoleGroup = String(step.payload['requiredRoleGroup'] ?? '');
    const quorumRaw = step.payload['quorum'];
    const quorum = typeof quorumRaw === 'number' ? quorumRaw : 1;
    const notifyRoleGroup =
      typeof step.payload['notifyRoleGroup'] === 'string'
        ? (step.payload['notifyRoleGroup'] as string)
        : null;
    const timeoutMs =
      typeof step.payload['timeoutMs'] === 'number'
        ? (step.payload['timeoutMs'] as number)
        : DEFAULT_TIMEOUT_MS;

    if (!actionType || !requiredRoleGroup) {
      return {
        status: 'FAILED',
        error: {
          code: 'INVALID_PAYLOAD',
          message:
            'route_approval: actionType and requiredRoleGroup are required',
        },
      };
    }

    try {
      const created = await port.createApprovalRequest({
        tenantId: ctx.tenantId,
        planId: ctx.planId,
        stepId: ctx.stepId,
        actionType,
        proposerPersonaId: ctx.personaId,
        requiredRoleGroup,
        quorum,
        notifyRoleGroup,
        payload: { ...step.payload },
        toolCallRef: ctx.toolCallRef ?? ctx.stepId,
      });

      if (created.status === 'approved') {
        return {
          status: 'SUCCEEDED',
          resultPayload: { approvalId: created.approvalId, autoApproved: true },
        };
      }
      if (created.status === 'rejected') {
        return {
          status: 'FAILED',
          error: {
            code: 'APPROVAL_REJECTED',
            message: 'approval rejected at creation',
          },
        };
      }

      const terminal = await port.awaitTerminal({
        approvalId: created.approvalId,
        timeoutMs,
      });
      if (terminal.status === 'approved') {
        return {
          status: 'SUCCEEDED',
          resultPayload: { approvalId: created.approvalId },
        };
      }
      if (terminal.status === 'rejected') {
        return {
          status: 'FAILED',
          error: { code: 'APPROVAL_REJECTED', message: 'approval rejected' },
        };
      }
      return {
        status: 'FAILED',
        error: { code: 'APPROVAL_TIMEOUT', message: 'approval timed out' },
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: {
          code: 'APPROVAL_HANDLER_ERROR',
          message: err instanceof Error ? err.message : 'route_approval failed',
        },
      };
    }
  };
}

export const routeApprovalHandler = (): never => {
  throw new Error(
    'routeApprovalHandler must be built via makeRouteApprovalHandler',
  );
};
