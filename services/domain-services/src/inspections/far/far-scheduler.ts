/**
 * FAR Scheduler (NEW 16)
 *
 * CRON-ish scanner that looks for FAR assignments whose `nextCheckDueAt` has
 * been reached and fans out a notification to the 3 convention recipients
 * (landlord, manager, vendor).
 *
 * The notification dispatch is delegated to an injected `NotificationDispatcher`
 * that mirrors the shape used elsewhere in the codebase. The concrete
 * transport (email/SMS/push/in-app) is the caller's concern.
 */

import type { ISOTimestamp, TenantId } from '@borjie/domain-models';
import type {
  FarAssignment,
  FarRepository,
  NotifyRecipient,
} from './types.js';

export interface NotificationDispatcher {
  dispatch(input: {
    tenantId: TenantId;
    recipient: NotifyRecipient;
    subject: string;
    body: string;
    context: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface FarSchedulerOptions {
  readonly tenantId?: TenantId | null;
  readonly now?: ISOTimestamp;
}

export class FarScheduler {
  constructor(
    private readonly repo: FarRepository,
    private readonly dispatcher: NotificationDispatcher
  ) {}

  /**
   * Scans due assignments and notifies their recipients.
   * Returns the assignments that triggered notifications.
   *
   * Follow-up KI-007 (#33): wire to AI persona — if a trigger rule requests
   *   AI-generated prose ("summarise last 3 check events"), call the
   *   persona here before dispatch. See Docs/KNOWN_ISSUES.md#ki-007.
   */
  async run(
    options?: FarSchedulerOptions
  ): Promise<readonly FarAssignment[]> {
    const now = options?.now ?? (new Date().toISOString() as ISOTimestamp);
    const dueAssignments = await this.repo.findDueAssignments(
      options?.tenantId ?? null,
      now
    );

    for (const assignment of dueAssignments) {
      await this.notifyAll(assignment, now);
    }

    return dueAssignments;
  }

  private async notifyAll(
    assignment: FarAssignment,
    now: ISOTimestamp
  ): Promise<void> {
    const recipients = assignment.notifyRecipients;
    if (recipients.length === 0) return;

    const subject = `FAR condition check due for component ${assignment.componentId}`;
    const body = `A condition check for component ${assignment.componentId} is due on ${assignment.nextCheckDueAt ?? 'now'}. Please complete the inspection or reschedule.`;

    for (const recipient of recipients) {
      try {
        await this.dispatcher.dispatch({
          tenantId: assignment.tenantId,
          recipient,
          subject,
          body,
          context: {
            assignmentId: assignment.id,
            componentId: assignment.componentId,
            frequency: assignment.frequency,
            nextCheckDueAt: assignment.nextCheckDueAt,
            dispatchedAt: now,
          },
        });
      } catch (error) {
        // Delivery errors are logged by the dispatcher; continue to the next
        // recipient rather than failing the whole scan.
        // eslint-disable-next-line no-console
        console.error(
          `FAR notification failed for recipient ${recipient.role} on assignment ${assignment.id}`,
          error
        );
      }
    }
  }
}
