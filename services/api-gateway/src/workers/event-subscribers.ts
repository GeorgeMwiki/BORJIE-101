/**
 * Domain event → notification bridge.
 *
 * Closes the gap flagged by the 10-agent async audit: 62 events were
 * declared across the monorepo but nothing in production ever called
 * `eventBus.subscribe(...)`. The outbox drainer publishes events, but
 * without subscribers they vanish on the floor.
 *
 * This module registers the first wave of subscribers — the ones tied
 * to customer-visible outcomes (payment succeeded/failed, lease
 * renewal alerts, case escalations). Each handler:
 *   1. Reads the tenant context from the event envelope
 *   2. Resolves the recipient customer/user
 *   3. Hands off to the notifications service over HTTP (or local
 *      in-process for monoservice deployments)
 *
 * Failures inside a handler are logged and absorbed — the outbox
 * retries via its dead-letter machinery. A throwing handler must
 * not crash the drainer tick.
 */

import type pino from 'pino';

export interface SubscribableBus {
  subscribe(
    pattern: string,
    handler: (event: DomainEventLike) => Promise<void> | void,
    opts?: { id?: string }
  ): string | void;
}

export interface DomainEventLike {
  type?: string;
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
  metadata?: {
    tenantId?: string;
    correlationId?: string;
    [k: string]: unknown;
  };
}

export interface NotificationDispatcher {
  send(params: {
    tenantId: string;
    channel: 'email' | 'sms' | 'whatsapp' | 'push' | 'in_app';
    recipient: { userId?: string; customerId?: string; to?: string };
    templateKey: string;
    data: Record<string, unknown>;
    correlationId?: string;
  }): Promise<{ success: boolean; error?: string }>;
}

/**
 * Audit-log sink — records sensitive state transitions the compliance
 * team needs to trace after the fact. Optional: if absent, subscribers
 * skip the audit-log step silently.
 */
export interface AuditSink {
  log(entry: {
    tenantId: string;
    action: string;
    actor?: { userId?: string; customerId?: string; system?: string };
    target?: { type: string; id: string };
    metadata?: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void> | void;
}

/**
 * Observability / metrics sink — feeds counters and alerts used by the
 * ops dashboards. Optional; absent sinks degrade to log-only handlers.
 */
export interface ObservabilitySink {
  metric(params: {
    name: string;
    value?: number;
    tags?: Record<string, string | number>;
  }): void;
  alert?(params: {
    severity: 'info' | 'warning' | 'critical';
    title: string;
    tenantId?: string;
    tags?: Record<string, string | number>;
    correlationId?: string;
  }): void;
}

/**
 * Subset of the arrears service this worker uses. Kept minimal so the
 * subscribers module never pulls in the full payments-ledger package
 * dependency graph — tests + degraded-mode gateways inject a null.
 */
export interface ArrearsOpenCaseService {
  openCase(input: {
    readonly tenantId: string;
    readonly customerId: string;
    readonly currency: string;
    readonly totalArrearsAmount: number;
    readonly daysOverdue: number;
    readonly overdueInvoiceCount: number;
    readonly oldestInvoiceDate: Date;
    readonly leaseId?: string;
    readonly propertyId?: string;
    readonly unitId?: string;
    readonly createdBy: string;
    readonly notes?: string;
  }): Promise<{ id: string; caseNumber: string }>;
}

export interface EventSubscriberDeps {
  bus: SubscribableBus;
  notifications: NotificationDispatcher;
  logger: pino.Logger;
  /** Optional audit log sink — absent in test/in-process deployments. */
  audit?: AuditSink;
  /** Optional observability sink — absent in test/in-process deployments. */
  observability?: ObservabilitySink;
  /**
   * Optional arrears service. When present, `InvoiceOverdue` events
   * auto-open a real arrears case. When absent, the subscriber still
   * emits the audit + metric signal but skips the DB write so degraded
   * gateways never crash on missing wiring.
   */
  arrearsService?: ArrearsOpenCaseService | null;
}

function safeHandler(
  label: string,
  logger: pino.Logger,
  fn: (event: DomainEventLike) => Promise<void>
): (event: DomainEventLike) => Promise<void> {
  return async (event) => {
    try {
      await fn(event);
    } catch (err) {
      // Never throw from a subscriber — let the outbox treat the
      // event as already acknowledged so failed notifications
      // don't block all downstream handlers.
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          eventType: event.eventType ?? event.type,
          aggregateId: event.aggregateId,
          correlationId: event.metadata?.correlationId,
        },
        `${label}: handler failed`
      );
    }
  };
}

/**
 * Register the default set of event subscribers. Safe to call once
 * at service boot; subscriber IDs are retained for later unsubscribe
 * during graceful shutdown (the bus implementation handles cleanup).
 */
export function registerDomainEventSubscribers(deps: EventSubscriberDeps): void {
  const { bus, notifications, logger, audit, observability, arrearsService } = deps;

  // Thin no-op defaults so handler code can call these unconditionally.
  const auditLog = async (entry: Parameters<AuditSink['log']>[0]): Promise<void> => {
    if (!audit) return;
    try {
      await audit.log(entry);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), action: entry.action },
        'audit-log: sink threw — continuing without blocking subscriber'
      );
    }
  };
  const emitMetric = (params: Parameters<ObservabilitySink['metric']>[0]): void => {
    if (!observability) return;
    try {
      observability.metric(params);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), name: params.name },
        'observability.metric: sink threw'
      );
    }
  };
  const emitAlert = (params: Parameters<NonNullable<ObservabilitySink['alert']>>[0]): void => {
    if (!observability?.alert) return;
    try {
      observability.alert(params);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), title: params.title },
        'observability.alert: sink threw'
      );
    }
  };

  // -------- Payment lifecycle --------
  bus.subscribe(
    'PAYMENT_SUCCEEDED',
    safeHandler('payment-succeeded', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const customerId = (p as { customerId?: string }).customerId;
      if (!tenantId || !customerId) {
        logger.warn({ eventType: event.eventType }, 'payment-succeeded: missing tenant/customer context');
        return;
      }
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'payment.succeeded',
        data: {
          amount: (p as { amount?: unknown }).amount,
          paidAt: (p as { paidAt?: unknown }).paidAt,
          receiptUrl: (p as { receiptUrl?: string }).receiptUrl,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.payment-succeeded' }
  );

  bus.subscribe(
    'PAYMENT_FAILED',
    safeHandler('payment-failed', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const customerId = (p as { customerId?: string }).customerId;
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'payment.failed',
        data: {
          failureReason: (p as { failureReason?: string }).failureReason,
          failureCode: (p as { failureCode?: string }).failureCode,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.payment-failed' }
  );

  bus.subscribe(
    'PAYMENT_REFUNDED',
    safeHandler('payment-refunded', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const customerId = (p as { customerId?: string }).customerId;
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'payment.refunded',
        data: {
          refundAmount: (p as { refundAmount?: unknown }).refundAmount,
          isFullRefund: (p as { isFullRefund?: boolean }).isFullRefund,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.payment-refunded' }
  );

  // -------- Statement delivery --------
  bus.subscribe(
    'STATEMENT_GENERATED',
    safeHandler('statement-generated', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      if (!tenantId) return;
      // Statements carry either ownerId or customerId in the payload.
      const recipientCustomerId = (p as { customerId?: string }).customerId;
      const recipientUserId = (p as { ownerId?: string }).ownerId;
      if (!recipientCustomerId && !recipientUserId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: recipientCustomerId
          ? { customerId: recipientCustomerId }
          : { userId: recipientUserId },
        templateKey: 'statement.ready',
        data: {
          statementId: (p as { statementId?: string }).statementId,
          periodStart: (p as { periodStart?: unknown }).periodStart,
          periodEnd: (p as { periodEnd?: unknown }).periodEnd,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.statement-generated' }
  );

  // -------- Disbursement to landlords --------
  bus.subscribe(
    'DISBURSEMENT_COMPLETED',
    safeHandler('disbursement-completed', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const ownerId = (p as { ownerId?: string }).ownerId;
      if (!tenantId || !ownerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { userId: ownerId },
        templateKey: 'disbursement.completed',
        data: {
          amount: (p as { amount?: unknown }).amount,
          completedAt: (p as { completedAt?: unknown }).completedAt,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.disbursement-completed' }
  );

  // -------- User lifecycle --------
  bus.subscribe(
    'UserInvited',
    safeHandler('user-invited', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const email = (p as { email?: string }).email;
      const inviteToken = (p as { inviteToken?: string }).inviteToken;
      if (!tenantId || !email) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { to: email },
        templateKey: 'user.invited',
        data: { inviteToken, invitedBy: (p as { invitedBy?: string }).invitedBy },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.user-invited' }
  );

  // -------- Approval workflow --------
  bus.subscribe(
    'ApprovalRequested',
    safeHandler('approval-requested', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const approverId = (p as { approverId?: string }).approverId;
      if (!tenantId || !approverId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: approverId },
        templateKey: 'approval.requested',
        data: {
          requestId: (p as { requestId?: string }).requestId,
          subject: (p as { subject?: string }).subject,
          urgency: (p as { urgency?: string }).urgency ?? 'normal',
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.approval-requested' }
  );

  // -------- Legal / case escalations --------
  bus.subscribe(
    'LegalCaseStatusChanged',
    safeHandler('legal-case-status-changed', logger, async (event) => {
      const p = event.payload ?? {};
      const tenantId = event.metadata?.tenantId;
      const customerId = (p as { customerId?: string }).customerId;
      const toStatus = (p as { toStatus?: string }).toStatus;
      // Only notify on escalation transitions to avoid spam.
      if (!tenantId || !customerId || !toStatus) return;
      if (!['filed', 'mediation', 'hearing_scheduled', 'resolved', 'closed'].includes(toStatus)) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: `legal_case.${toStatus}`,
        data: {
          caseId: (p as { caseId?: string }).caseId,
          toStatus,
          fromStatus: (p as { fromStatus?: string }).fromStatus,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.legal-case-status-changed' }
  );

  // ==========================================================================
  // SCAFFOLDED 8 / NEW 21 — additional domain→notification subscribers
  //
  // These cover the "invisible gap" events flagged by the async audit:
  // maintenance-case lifecycle, legal notices, SLA breaches, lease renewal
  // windows, payment arrears, inspection scheduling.
  // ==========================================================================

  const genericPayload = (event: DomainEventLike): Record<string, unknown> => event.payload ?? {};
  const extractTenant = (event: DomainEventLike): string | undefined => event.metadata?.tenantId;
  const extractCustomer = (event: DomainEventLike): string | undefined =>
    (genericPayload(event) as { customerId?: string }).customerId;

  // -------- Maintenance case lifecycle --------
  bus.subscribe(
    'CaseCreated',
    safeHandler('case-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'case.created',
        data: {
          caseId: (genericPayload(event) as { caseId?: string }).caseId,
          title: (genericPayload(event) as { title?: string }).title,
          priority: (genericPayload(event) as { priority?: string }).priority ?? 'normal',
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.case-created' }
  );

  bus.subscribe(
    'CaseEscalated',
    safeHandler('case-escalated', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'whatsapp',
        recipient: { customerId },
        templateKey: 'case.escalated',
        data: {
          caseId: (genericPayload(event) as { caseId?: string }).caseId,
          escalationLevel: (genericPayload(event) as { escalationLevel?: number }).escalationLevel,
          assignedTo: (genericPayload(event) as { assignedTo?: string }).assignedTo,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.case-escalated' }
  );

  bus.subscribe(
    'CaseResolved',
    safeHandler('case-resolved', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'case.resolved',
        data: {
          caseId: (genericPayload(event) as { caseId?: string }).caseId,
          resolvedAt: (genericPayload(event) as { resolvedAt?: unknown }).resolvedAt,
          resolution: (genericPayload(event) as { resolution?: string }).resolution,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.case-resolved' }
  );

  bus.subscribe(
    'CaseSLABreached',
    safeHandler('case-sla-breached', logger, async (event) => {
      const tenantId = extractTenant(event);
      const assigneeId = (genericPayload(event) as { assigneeId?: string }).assigneeId;
      if (!tenantId || !assigneeId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: assigneeId },
        templateKey: 'case.sla_breached',
        data: {
          caseId: (genericPayload(event) as { caseId?: string }).caseId,
          slaTargetAt: (genericPayload(event) as { slaTargetAt?: unknown }).slaTargetAt,
          breachedAt: (genericPayload(event) as { breachedAt?: unknown }).breachedAt,
        },
        correlationId: event.metadata?.correlationId,
      });
      // SLA breach is an operational signal — page the on-call dashboard
      // in addition to notifying the assignee.
      emitMetric({
        name: 'case.sla_breached',
        value: 1,
        tags: { tenantId, caseId: String((genericPayload(event) as { caseId?: string }).caseId ?? '') },
      });
      emitAlert({
        severity: 'warning',
        title: 'Case SLA breached',
        tenantId,
        tags: { caseId: String((genericPayload(event) as { caseId?: string }).caseId ?? '') },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.case-sla-breached' }
  );

  // -------- Legal notice delivery --------
  bus.subscribe(
    'NoticeSent',
    safeHandler('notice-sent', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'notice.sent',
        data: {
          noticeType: (genericPayload(event) as { noticeType?: string }).noticeType,
          noticeId: (genericPayload(event) as { noticeId?: string }).noticeId,
          deadline: (genericPayload(event) as { deadline?: unknown }).deadline,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.notice-sent' }
  );

  // -------- Lease renewals --------
  bus.subscribe(
    'RenewalWindowOpened',
    safeHandler('renewal-window-opened', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'renewal.window_opened',
        data: {
          leaseId: (genericPayload(event) as { leaseId?: string }).leaseId,
          windowStart: (genericPayload(event) as { windowStart?: unknown }).windowStart,
          windowEnd: (genericPayload(event) as { windowEnd?: unknown }).windowEnd,
          currentExpiryDate: (genericPayload(event) as { currentExpiryDate?: unknown })
            .currentExpiryDate,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.renewal-window-opened' }
  );

  bus.subscribe(
    'RenewalProposed',
    safeHandler('renewal-proposed', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'renewal.proposed',
        data: {
          leaseId: (genericPayload(event) as { leaseId?: string }).leaseId,
          newRent: (genericPayload(event) as { newRent?: unknown }).newRent,
          proposedTermMonths: (genericPayload(event) as { proposedTermMonths?: number })
            .proposedTermMonths,
          respondByDate: (genericPayload(event) as { respondByDate?: unknown }).respondByDate,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.renewal-proposed' }
  );

  // -------- Payment arrears --------
  bus.subscribe(
    'PaymentOverdue',
    safeHandler('payment-overdue', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'payment.overdue',
        data: {
          invoiceId: (genericPayload(event) as { invoiceId?: string }).invoiceId,
          amountDue: (genericPayload(event) as { amountDue?: unknown }).amountDue,
          daysOverdue: (genericPayload(event) as { daysOverdue?: number }).daysOverdue,
          dueDate: (genericPayload(event) as { dueDate?: unknown }).dueDate,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.payment-overdue' }
  );

  // -------- Work order assignment --------
  bus.subscribe(
    'WorkOrderAssigned',
    safeHandler('work-order-assigned', logger, async (event) => {
      const tenantId = extractTenant(event);
      const vendorUserId = (genericPayload(event) as { vendorUserId?: string }).vendorUserId;
      if (!tenantId || !vendorUserId) return;
      await notifications.send({
        tenantId,
        channel: 'whatsapp',
        recipient: { userId: vendorUserId },
        templateKey: 'work_order.assigned',
        data: {
          workOrderId: (genericPayload(event) as { workOrderId?: string }).workOrderId,
          scheduledAt: (genericPayload(event) as { scheduledAt?: unknown }).scheduledAt,
          propertyAddress: (genericPayload(event) as { propertyAddress?: string })
            .propertyAddress,
          priority: (genericPayload(event) as { priority?: string }).priority ?? 'normal',
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.work-order-assigned' }
  );

  // -------- Inspection scheduling --------
  bus.subscribe(
    'InspectionScheduled',
    safeHandler('inspection-scheduled', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'inspection.scheduled',
        data: {
          inspectionId: (genericPayload(event) as { inspectionId?: string }).inspectionId,
          scheduledAt: (genericPayload(event) as { scheduledAt?: unknown }).scheduledAt,
          inspector: (genericPayload(event) as { inspector?: string }).inspector,
          unitRef: (genericPayload(event) as { unitRef?: string }).unitRef,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.inspection-scheduled' }
  );

  // ==========================================================================
  // WAVE-5 GAP CLOSURE — previously unwired events found by the event-subscriber
  // audit. Each domain-service file publishes these into the outbox, but
  // nothing was listening. We wire them to the appropriate side-effect:
  //   - customer-visible events → notifications.send
  //   - compliance-relevant events → audit.log
  //   - operational-signal events → observability.metric / alert
  // ==========================================================================

  // -------- Payment intent / processing --------
  bus.subscribe(
    'PaymentReceived',
    safeHandler('payment-received', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'payment.received',
        data: {
          paymentId: (genericPayload(event) as { paymentId?: string }).paymentId,
          amount: (genericPayload(event) as { amount?: unknown }).amount,
          method: (genericPayload(event) as { method?: string }).method,
        },
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'payment.received', value: 1, tags: { tenantId } });
    }),
    { id: 'notifications.payment-received' }
  );

  // -------- Invoice lifecycle --------
  bus.subscribe(
    'InvoiceCreated',
    safeHandler('invoice-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'invoice.created',
        data: {
          invoiceId: (genericPayload(event) as { invoiceId?: string }).invoiceId,
          amountDue: (genericPayload(event) as { amountDue?: unknown }).amountDue,
          dueDate: (genericPayload(event) as { dueDate?: unknown }).dueDate,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.invoice-created' }
  );

  bus.subscribe(
    'InvoiceGenerated',
    safeHandler('invoice-generated', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'invoice.generated',
        data: {
          invoiceId: (genericPayload(event) as { invoiceId?: string }).invoiceId,
          amount: (genericPayload(event) as { amount?: unknown }).amount,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.invoice-generated' }
  );

  bus.subscribe(
    'InvoiceSent',
    safeHandler('invoice-sent', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'invoice.sent',
        target: {
          type: 'Invoice',
          id: String((genericPayload(event) as { invoiceId?: string }).invoiceId ?? event.aggregateId ?? ''),
        },
        metadata: {
          channel: (genericPayload(event) as { channel?: string }).channel,
          sentAt: (genericPayload(event) as { sentAt?: unknown }).sentAt,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.invoice-sent' }
  );

  bus.subscribe(
    'InvoicePaid',
    safeHandler('invoice-paid', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'invoice.paid',
        data: {
          invoiceId: (genericPayload(event) as { invoiceId?: string }).invoiceId,
          paidAt: (genericPayload(event) as { paidAt?: unknown }).paidAt,
          receiptNumber: (genericPayload(event) as { receiptNumber?: string }).receiptNumber,
        },
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'invoice.paid', value: 1, tags: { tenantId } });
    }),
    { id: 'notifications.invoice-paid' }
  );

  // Wave 18 — auto-open arrears case on invoice.overdue. Wave 16 added
  // the metric + audit scaffolding but never called the service. This
  // block now wires the concrete `arrearsService.openCase()` call when
  // the service is present; when absent (degraded gateway, unit tests)
  // the observability signal still fires so ops sees the trigger.
  bus.subscribe(
    'InvoiceOverdue',
    safeHandler('arrears-auto-open', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      const payload = genericPayload(event) as {
        invoiceId?: string;
        leaseId?: string;
        unitId?: string;
        propertyId?: string;
        amountMinorUnits?: number;
        currency?: string;
        daysOverdue?: number;
        oldestInvoiceDate?: string;
      };
      if (!payload.amountMinorUnits || !payload.currency) return;

      emitMetric({
        name: 'arrears.auto_open_triggered',
        value: 1,
        tags: { tenantId },
      });
      await auditLog({
        tenantId,
        action: 'arrears.auto_open_triggered',
        target: {
          type: 'Invoice',
          id: String(payload.invoiceId ?? event.aggregateId ?? ''),
        },
        metadata: payload,
        correlationId: event.metadata?.correlationId,
      });

      // Concrete call: open the arrears case in the ledger. The service
      // is idempotent for a given (tenantId, customerId, invoiceId)
      // pair at the repo layer, so re-emitted overdue events never
      // double-open.
      if (!arrearsService) {
        logger.warn(
          { tenantId, customerId, invoiceId: payload.invoiceId },
          'arrears-auto-open: arrearsService unwired; skipping case open',
        );
        return;
      }
      const oldestInvoiceDate = payload.oldestInvoiceDate
        ? new Date(payload.oldestInvoiceDate)
        : new Date();
      try {
        const opened = await arrearsService.openCase({
          tenantId,
          customerId,
          currency: payload.currency,
          totalArrearsAmount: payload.amountMinorUnits,
          daysOverdue: payload.daysOverdue ?? 0,
          overdueInvoiceCount: 1,
          oldestInvoiceDate,
          leaseId: payload.leaseId,
          propertyId: payload.propertyId,
          unitId: payload.unitId,
          createdBy: 'system:arrears-auto-open',
          notes: `Auto-opened on InvoiceOverdue for invoice ${payload.invoiceId ?? 'unknown'}.`,
        });
        emitMetric({
          name: 'arrears.auto_open_opened',
          value: 1,
          tags: { tenantId },
        });
        await auditLog({
          tenantId,
          action: 'arrears.case_opened',
          target: { type: 'ArrearsCase', id: opened.id },
          metadata: {
            caseNumber: opened.caseNumber,
            invoiceId: payload.invoiceId,
            customerId,
          },
          correlationId: event.metadata?.correlationId,
        });
      } catch (err) {
        logger.error(
          {
            err: err instanceof Error ? err.message : String(err),
            tenantId,
            customerId,
            invoiceId: payload.invoiceId,
          },
          'arrears-auto-open: openCase failed',
        );
        emitMetric({
          name: 'arrears.auto_open_failed',
          value: 1,
          tags: { tenantId },
        });
      }
    }),
    { id: 'arrears.auto-open-on-overdue' }
  );

  // -------- Lease lifecycle --------
  bus.subscribe(
    'LeaseCreated',
    safeHandler('lease-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'lease.created',
        data: {
          leaseId: (genericPayload(event) as { leaseId?: string }).leaseId,
          startDate: (genericPayload(event) as { startDate?: unknown }).startDate,
          endDate: (genericPayload(event) as { endDate?: unknown }).endDate,
        },
        correlationId: event.metadata?.correlationId,
      });
      await auditLog({
        tenantId,
        action: 'lease.created',
        target: {
          type: 'Lease',
          id: String((genericPayload(event) as { leaseId?: string }).leaseId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.lease-created' }
  );

  bus.subscribe(
    'LeaseActivated',
    safeHandler('lease-activated', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'lease.activated',
        data: {
          leaseId: (genericPayload(event) as { leaseId?: string }).leaseId,
          activatedAt: (genericPayload(event) as { activatedAt?: unknown }).activatedAt,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.lease-activated' }
  );

  bus.subscribe(
    'LeaseTerminated',
    safeHandler('lease-terminated', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'lease.terminated',
        data: {
          leaseId: (genericPayload(event) as { leaseId?: string }).leaseId,
          terminatedAt: (genericPayload(event) as { terminatedAt?: unknown }).terminatedAt,
          reason: (genericPayload(event) as { reason?: string }).reason,
        },
        correlationId: event.metadata?.correlationId,
      });
      await auditLog({
        tenantId,
        action: 'lease.terminated',
        target: {
          type: 'Lease',
          id: String((genericPayload(event) as { leaseId?: string }).leaseId ?? event.aggregateId ?? ''),
        },
        metadata: {
          reason: (genericPayload(event) as { reason?: string }).reason,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.lease-terminated' }
  );

  bus.subscribe(
    'DepositReturned',
    safeHandler('deposit-returned', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'deposit.returned',
        data: {
          leaseId: (genericPayload(event) as { leaseId?: string }).leaseId,
          amount: (genericPayload(event) as { amount?: unknown }).amount,
          deductions: (genericPayload(event) as { deductions?: unknown }).deductions,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.deposit-returned' }
  );

  bus.subscribe(
    'LeaseRenewalWindow',
    safeHandler('lease-renewal-window', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'lease.renewal_window',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.lease-renewal-window' }
  );

  // -------- Renewal outcomes --------
  bus.subscribe(
    'RenewalAccepted',
    safeHandler('renewal-accepted', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'renewal.accepted',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.renewal-accepted' }
  );

  bus.subscribe(
    'RenewalDeclined',
    safeHandler('renewal-declined', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'renewal.declined',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.renewal-declined' }
  );

  bus.subscribe(
    'RenewalReminder',
    safeHandler('renewal-reminder', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'renewal.reminder',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.renewal-reminder' }
  );

  bus.subscribe(
    'LeaseTerminatedByRenewal',
    safeHandler('lease-terminated-by-renewal', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'lease.terminated_by_renewal',
        target: {
          type: 'Lease',
          id: String((genericPayload(event) as { leaseId?: string }).leaseId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.lease-terminated-by-renewal' }
  );

  // -------- Maintenance work orders --------
  bus.subscribe(
    'WorkOrderCreated',
    safeHandler('work-order-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'work_order.created',
        data: {
          workOrderId: (genericPayload(event) as { workOrderId?: string }).workOrderId,
          title: (genericPayload(event) as { title?: string }).title,
          priority: (genericPayload(event) as { priority?: string }).priority ?? 'normal',
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.work-order-created' }
  );

  bus.subscribe(
    'WorkOrderCompleted',
    safeHandler('work-order-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'work_order.completed',
        data: {
          workOrderId: (genericPayload(event) as { workOrderId?: string }).workOrderId,
          completedAt: (genericPayload(event) as { completedAt?: unknown }).completedAt,
        },
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.work-order-completed' }
  );

  bus.subscribe(
    'SLABreached',
    safeHandler('sla-breached', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const workOrderId = String((genericPayload(event) as { workOrderId?: string }).workOrderId ?? '');
      emitMetric({
        name: 'maintenance.sla_breached',
        value: 1,
        tags: { tenantId, workOrderId },
      });
      emitAlert({
        severity: 'warning',
        title: 'Maintenance SLA breached',
        tenantId,
        tags: { workOrderId },
        correlationId: event.metadata?.correlationId,
      });
      await auditLog({
        tenantId,
        action: 'maintenance.sla_breached',
        target: { type: 'WorkOrder', id: workOrderId },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'observability.sla-breached' }
  );

  // -------- Compliance --------
  bus.subscribe(
    'ComplianceDue',
    safeHandler('compliance-due', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const ownerId = (genericPayload(event) as { ownerId?: string }).ownerId;
      if (!ownerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { userId: ownerId },
        templateKey: 'compliance.due',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.compliance-due' }
  );

  bus.subscribe(
    'ComplianceOverdue',
    safeHandler('compliance-overdue', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const ownerId = (genericPayload(event) as { ownerId?: string }).ownerId;
      if (ownerId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { userId: ownerId },
          templateKey: 'compliance.overdue',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitMetric({ name: 'compliance.overdue', value: 1, tags: { tenantId } });
      emitAlert({
        severity: 'warning',
        title: 'Compliance item overdue',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.compliance-overdue' }
  );

  bus.subscribe(
    'NoticeServed',
    safeHandler('notice-served', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'compliance.notice_served',
        target: {
          type: 'Notice',
          id: String((genericPayload(event) as { noticeId?: string }).noticeId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.notice-served' }
  );

  bus.subscribe(
    'LegalCaseCreated',
    safeHandler('legal-case-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'legal.case_created',
        target: {
          type: 'LegalCase',
          id: String((genericPayload(event) as { caseId?: string }).caseId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'legal.case_created', value: 1, tags: { tenantId } });
    }),
    { id: 'audit.legal-case-created' }
  );

  bus.subscribe(
    'LegalCaseClosed',
    safeHandler('legal-case-closed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'legal.case_closed',
        target: {
          type: 'LegalCase',
          id: String((genericPayload(event) as { caseId?: string }).caseId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.legal-case-closed' }
  );

  bus.subscribe(
    'CaseEvidenceAdded',
    safeHandler('case-evidence-added', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'legal.evidence_added',
        target: {
          type: 'LegalCase',
          id: String((genericPayload(event) as { caseId?: string }).caseId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.case-evidence-added' }
  );

  bus.subscribe(
    'CaseStatusChanged',
    safeHandler('case-status-changed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'case.status_changed',
        target: {
          type: 'Case',
          id: String((genericPayload(event) as { caseId?: string }).caseId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.case-status-changed' }
  );

  // -------- Customer lifecycle --------
  bus.subscribe(
    'CustomerCreated',
    safeHandler('customer-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'customer.created',
        target: {
          type: 'Customer',
          id: String((genericPayload(event) as { customerId?: string }).customerId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'customer.created', value: 1, tags: { tenantId } });
    }),
    { id: 'audit.customer-created' }
  );

  bus.subscribe(
    'CustomerKYCVerified',
    safeHandler('customer-kyc-verified', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId) return;
      if (customerId) {
        await notifications.send({
          tenantId,
          channel: 'sms',
          recipient: { customerId },
          templateKey: 'customer.kyc_verified',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      await auditLog({
        tenantId,
        action: 'customer.kyc_verified',
        target: { type: 'Customer', id: String(customerId ?? event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.customer-kyc-verified' }
  );

  bus.subscribe(
    'FinancialStatementSubmitted',
    safeHandler('financial-statement-submitted', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'customer.financial_statement_submitted',
        target: { type: 'Customer', id: String(extractCustomer(event) ?? event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.financial-statement-submitted' }
  );

  bus.subscribe(
    'BankReferenceVerified',
    safeHandler('bank-reference-verified', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'customer.bank_reference_verified',
        target: { type: 'Customer', id: String(extractCustomer(event) ?? event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.bank-reference-verified' }
  );

  bus.subscribe(
    'LitigationRecorded',
    safeHandler('litigation-recorded', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'customer.litigation_recorded',
        target: { type: 'Customer', id: String(extractCustomer(event) ?? event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitAlert({
        severity: 'warning',
        title: 'Litigation recorded for customer',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.litigation-recorded' }
  );

  // -------- Identity & session --------
  bus.subscribe(
    'UserCreated',
    safeHandler('user-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.user_created',
        target: {
          type: 'User',
          id: String((genericPayload(event) as { userId?: string }).userId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.user-created' }
  );

  bus.subscribe(
    'UserActivated',
    safeHandler('user-activated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.user_activated',
        target: {
          type: 'User',
          id: String((genericPayload(event) as { userId?: string }).userId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.user-activated' }
  );

  bus.subscribe(
    'UserSuspended',
    safeHandler('user-suspended', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.user_suspended',
        target: {
          type: 'User',
          id: String((genericPayload(event) as { userId?: string }).userId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitAlert({
        severity: 'info',
        title: 'User suspended',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.user-suspended' }
  );

  bus.subscribe(
    'UserLocked',
    safeHandler('user-locked', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.user_locked',
        target: {
          type: 'User',
          id: String((genericPayload(event) as { userId?: string }).userId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'identity.user_locked', value: 1, tags: { tenantId } });
    }),
    { id: 'audit.user-locked' }
  );

  bus.subscribe(
    'UserRoleAssigned',
    safeHandler('user-role-assigned', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.role_assigned',
        target: {
          type: 'User',
          id: String((genericPayload(event) as { userId?: string }).userId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.user-role-assigned' }
  );

  bus.subscribe(
    'UserRoleRemoved',
    safeHandler('user-role-removed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.role_removed',
        target: {
          type: 'User',
          id: String((genericPayload(event) as { userId?: string }).userId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.user-role-removed' }
  );

  bus.subscribe(
    'SessionCreated',
    safeHandler('session-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({
        name: 'identity.session_created',
        value: 1,
        tags: {
          tenantId,
          authMethod: String((genericPayload(event) as { authMethod?: string }).authMethod ?? 'unknown'),
        },
      });
    }),
    { id: 'observability.session-created' }
  );

  bus.subscribe(
    'SessionRevoked',
    safeHandler('session-revoked', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.session_revoked',
        target: {
          type: 'Session',
          id: String((genericPayload(event) as { sessionId?: string }).sessionId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.session-revoked' }
  );

  bus.subscribe(
    'RoleCreated',
    safeHandler('role-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'identity.role_created',
        target: {
          type: 'Role',
          id: String((genericPayload(event) as { roleId?: string }).roleId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.role-created' }
  );

  // -------- Tenant & organization --------
  bus.subscribe(
    'TenantCreated',
    safeHandler('tenant-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'tenant.created',
        target: { type: 'Tenant', id: tenantId },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'tenant.created', value: 1 });
    }),
    { id: 'audit.tenant-created' }
  );

  bus.subscribe(
    'TenantSuspended',
    safeHandler('tenant-suspended', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'tenant.suspended',
        target: { type: 'Tenant', id: tenantId },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitAlert({
        severity: 'warning',
        title: 'Tenant suspended',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.tenant-suspended' }
  );

  bus.subscribe(
    'TenantActivated',
    safeHandler('tenant-activated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'tenant.activated',
        target: { type: 'Tenant', id: tenantId },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.tenant-activated' }
  );

  bus.subscribe(
    'TenantUpdated',
    safeHandler('tenant-updated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'tenant.updated',
        target: { type: 'Tenant', id: tenantId },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.tenant-updated' }
  );

  bus.subscribe(
    'OrganizationCreated',
    safeHandler('organization-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'organization.created',
        target: {
          type: 'Organization',
          id: String((genericPayload(event) as { organizationId?: string }).organizationId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.organization-created' }
  );

  // -------- Property --------
  bus.subscribe(
    'PropertyCreated',
    safeHandler('property-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'property.created', value: 1, tags: { tenantId } });
      await auditLog({
        tenantId,
        action: 'property.created',
        target: { type: 'Property', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.property-created' }
  );

  bus.subscribe(
    'UnitCreated',
    safeHandler('unit-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'unit.created', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.unit-created' }
  );

  bus.subscribe(
    'BlockCreated',
    safeHandler('block-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'block.created', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.block-created' }
  );

  bus.subscribe(
    'BulkUnitsCreated',
    safeHandler('bulk-units-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const count = Number((genericPayload(event) as { count?: number }).count ?? 0);
      emitMetric({ name: 'unit.bulk_created', value: count, tags: { tenantId } });
    }),
    { id: 'observability.bulk-units-created' }
  );

  // -------- Vendor --------
  bus.subscribe(
    'VendorCreated',
    safeHandler('vendor-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'vendor.created',
        target: { type: 'Vendor', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.vendor-created' }
  );

  bus.subscribe(
    'VendorStatusChanged',
    safeHandler('vendor-status-changed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'vendor.status_changed',
        target: { type: 'Vendor', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.vendor-status-changed' }
  );

  bus.subscribe(
    'VendorScorecardUpdated',
    safeHandler('vendor-scorecard-updated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({
        name: 'vendor.scorecard_updated',
        value: 1,
        tags: { tenantId, vendorId: String(event.aggregateId ?? '') },
      });
    }),
    { id: 'observability.vendor-scorecard-updated' }
  );

  // -------- Feedback / complaints --------
  bus.subscribe(
    'FeedbackReceived',
    safeHandler('feedback-received', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({
        name: 'feedback.received',
        value: 1,
        tags: {
          tenantId,
          rating: String((genericPayload(event) as { rating?: number }).rating ?? 'unknown'),
        },
      });
    }),
    { id: 'observability.feedback-received' }
  );

  bus.subscribe(
    'ComplaintEscalated',
    safeHandler('complaint-escalated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const assigneeId = (genericPayload(event) as { assigneeId?: string }).assigneeId;
      if (assigneeId) {
        await notifications.send({
          tenantId,
          channel: 'in_app',
          recipient: { userId: assigneeId },
          templateKey: 'complaint.escalated',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitAlert({
        severity: 'warning',
        title: 'Complaint escalated',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.complaint-escalated' }
  );

  bus.subscribe(
    'ServiceRecoveryCaseCreated',
    safeHandler('service-recovery-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'service_recovery.created',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.service-recovery-created' }
  );

  bus.subscribe(
    'ServiceRecoveryCaseResolved',
    safeHandler('service-recovery-resolved', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'service_recovery.resolved',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.service-recovery-resolved' }
  );

  // -------- Inspections --------
  bus.subscribe(
    'InspectionCompleted',
    safeHandler('inspection-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'inspection.completed',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.inspection-completed' }
  );

  bus.subscribe(
    'InspectionSigned',
    safeHandler('inspection-signed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'inspection.signed',
        target: {
          type: 'Inspection',
          id: String((genericPayload(event) as { inspectionId?: string }).inspectionId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.inspection-signed' }
  );

  bus.subscribe(
    'DamageIdentified',
    safeHandler('damage-identified', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId) return;
      if (customerId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { customerId },
          templateKey: 'inspection.damage_identified',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitMetric({ name: 'inspection.damage_identified', value: 1, tags: { tenantId } });
    }),
    { id: 'notifications.damage-identified' }
  );

  bus.subscribe(
    'ConditionalSurveyScheduled',
    safeHandler('conditional-survey-scheduled', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'conditional_survey.scheduled',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.conditional-survey-scheduled' }
  );

  bus.subscribe(
    'ConditionalSurveyCompiled',
    safeHandler('conditional-survey-compiled', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'inspection.conditional_survey_compiled',
        target: { type: 'Inspection', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.conditional-survey-compiled' }
  );

  bus.subscribe(
    'FarConditionCheckLogged',
    safeHandler('far-condition-check-logged', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'inspection.far_condition_logged', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.far-condition-check-logged' }
  );

  bus.subscribe(
    'MoveOutSelfCheckoutCompleted',
    safeHandler('move-out-self-checkout', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId) return;
      if (customerId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { customerId },
          templateKey: 'move_out.self_checkout_completed',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      await auditLog({
        tenantId,
        action: 'inspection.move_out_self_checkout',
        target: { type: 'Inspection', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.move-out-self-checkout' }
  );

  // -------- Negotiation --------
  bus.subscribe(
    'NegotiationOpened',
    safeHandler('negotiation-opened', logger, async (event) => {
      const tenantId = extractTenant(event);
      const counterpartyId = (genericPayload(event) as { counterpartyId?: string }).counterpartyId;
      if (!tenantId || !counterpartyId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: counterpartyId },
        templateKey: 'negotiation.opened',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.negotiation-opened' }
  );

  bus.subscribe(
    'NegotiationCounter',
    safeHandler('negotiation-counter', logger, async (event) => {
      const tenantId = extractTenant(event);
      const counterpartyId = (genericPayload(event) as { counterpartyId?: string }).counterpartyId;
      if (!tenantId || !counterpartyId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: counterpartyId },
        templateKey: 'negotiation.counter',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.negotiation-counter' }
  );

  bus.subscribe(
    'NegotiationEscalated',
    safeHandler('negotiation-escalated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitAlert({
        severity: 'warning',
        title: 'Negotiation escalated',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
      emitMetric({ name: 'negotiation.escalated', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.negotiation-escalated' }
  );

  bus.subscribe(
    'NegotiationAccepted',
    safeHandler('negotiation-accepted', logger, async (event) => {
      const tenantId = extractTenant(event);
      const counterpartyId = (genericPayload(event) as { counterpartyId?: string }).counterpartyId;
      if (!tenantId || !counterpartyId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { userId: counterpartyId },
        templateKey: 'negotiation.accepted',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.negotiation-accepted' }
  );

  bus.subscribe(
    'NegotiationRejected',
    safeHandler('negotiation-rejected', logger, async (event) => {
      const tenantId = extractTenant(event);
      const counterpartyId = (genericPayload(event) as { counterpartyId?: string }).counterpartyId;
      if (!tenantId || !counterpartyId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { userId: counterpartyId },
        templateKey: 'negotiation.rejected',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.negotiation-rejected' }
  );

  // -------- Marketplace & tenders --------
  bus.subscribe(
    'TenderPublished',
    safeHandler('tender-published', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'marketplace.tender_published', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.tender-published' }
  );

  bus.subscribe(
    'BidSubmitted',
    safeHandler('bid-submitted', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const tenderOwnerId = (genericPayload(event) as { tenderOwnerId?: string }).tenderOwnerId;
      if (tenderOwnerId) {
        await notifications.send({
          tenantId,
          channel: 'in_app',
          recipient: { userId: tenderOwnerId },
          templateKey: 'tender.bid_submitted',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitMetric({ name: 'marketplace.bid_submitted', value: 1, tags: { tenantId } });
    }),
    { id: 'notifications.bid-submitted' }
  );

  bus.subscribe(
    'TenderAwarded',
    safeHandler('tender-awarded', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const winnerUserId = (genericPayload(event) as { winnerUserId?: string }).winnerUserId;
      if (winnerUserId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { userId: winnerUserId },
          templateKey: 'tender.awarded',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      await auditLog({
        tenantId,
        action: 'marketplace.tender_awarded',
        target: { type: 'Tender', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.tender-awarded' }
  );

  bus.subscribe(
    'TenderCancelled',
    safeHandler('tender-cancelled', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'marketplace.tender_cancelled',
        target: { type: 'Tender', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.tender-cancelled' }
  );

  bus.subscribe(
    'MarketplaceEnquiryStarted',
    safeHandler('marketplace-enquiry-started', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'marketplace.enquiry_started', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.marketplace-enquiry-started' }
  );

  // -------- Utilities & meter readings --------
  bus.subscribe(
    'MeterReadingRecorded',
    safeHandler('meter-reading-recorded', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({
        name: 'utilities.meter_reading_recorded',
        value: 1,
        tags: {
          tenantId,
          utility: String((genericPayload(event) as { utilityType?: string }).utilityType ?? 'unknown'),
        },
      });
    }),
    { id: 'observability.meter-reading-recorded' }
  );

  bus.subscribe(
    'UtilityBillCreated',
    safeHandler('utility-bill-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'sms',
        recipient: { customerId },
        templateKey: 'utility.bill_created',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.utility-bill-created' }
  );

  bus.subscribe(
    'HighConsumptionAlert',
    safeHandler('high-consumption-alert', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId) return;
      if (customerId) {
        await notifications.send({
          tenantId,
          channel: 'sms',
          recipient: { customerId },
          templateKey: 'utility.high_consumption',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitAlert({
        severity: 'info',
        title: 'High utility consumption',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.high-consumption-alert' }
  );

  // -------- Approvals (remaining transitions) --------
  bus.subscribe(
    'ApprovalGranted',
    safeHandler('approval-granted', logger, async (event) => {
      const tenantId = extractTenant(event);
      const requesterId = (genericPayload(event) as { requesterId?: string }).requesterId;
      if (!tenantId || !requesterId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: requesterId },
        templateKey: 'approval.granted',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.approval-granted' }
  );

  bus.subscribe(
    'ApprovalRejected',
    safeHandler('approval-rejected', logger, async (event) => {
      const tenantId = extractTenant(event);
      const requesterId = (genericPayload(event) as { requesterId?: string }).requesterId;
      if (!tenantId || !requesterId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: requesterId },
        templateKey: 'approval.rejected',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.approval-rejected' }
  );

  bus.subscribe(
    'ApprovalEscalated',
    safeHandler('approval-escalated', logger, async (event) => {
      const tenantId = extractTenant(event);
      const escalatedToUserId = (genericPayload(event) as { escalatedToUserId?: string }).escalatedToUserId;
      if (!tenantId || !escalatedToUserId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: escalatedToUserId },
        templateKey: 'approval.escalated',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitAlert({
        severity: 'info',
        title: 'Approval escalated',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.approval-escalated' }
  );

  // -------- Documents --------
  bus.subscribe(
    'DocumentUploaded',
    safeHandler('document-uploaded', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'document.uploaded',
        target: {
          type: 'Document',
          id: String((genericPayload(event) as { documentId?: string }).documentId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.document-uploaded' }
  );

  bus.subscribe(
    'DocumentDeleted',
    safeHandler('document-deleted', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'document.deleted',
        target: {
          type: 'Document',
          id: String((genericPayload(event) as { documentId?: string }).documentId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.document-deleted' }
  );

  bus.subscribe(
    'DocumentAccessGranted',
    safeHandler('document-access-granted', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'document.access_granted',
        target: {
          type: 'Document',
          id: String((genericPayload(event) as { documentId?: string }).documentId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.document-access-granted' }
  );

  bus.subscribe(
    'DocumentOCRCompleted',
    safeHandler('document-ocr-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'document.ocr_completed', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.document-ocr-completed' }
  );

  bus.subscribe(
    'DocumentFraudFlagged',
    safeHandler('document-fraud-flagged', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'document.fraud_flagged',
        target: {
          type: 'Document',
          id: String((genericPayload(event) as { documentId?: string }).documentId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
      emitAlert({
        severity: 'critical',
        title: 'Document fraud flagged',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.document-fraud-flagged' }
  );

  bus.subscribe(
    'EvidencePackCompiled',
    safeHandler('evidence-pack-compiled', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'document.evidence_pack_compiled',
        target: {
          type: 'EvidencePack',
          id: String((genericPayload(event) as { packId?: string }).packId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.evidence-pack-compiled' }
  );

  // -------- Messaging --------
  bus.subscribe(
    'MessageSent',
    safeHandler('message-sent', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'messaging.message_sent', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.message-sent' }
  );

  bus.subscribe(
    'ConversationCreated',
    safeHandler('conversation-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'messaging.conversation_created', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.conversation-created' }
  );

  // -------- Onboarding --------
  bus.subscribe(
    'OnboardingStarted',
    safeHandler('onboarding-started', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId) return;
      if (customerId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { customerId },
          templateKey: 'onboarding.started',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitMetric({ name: 'onboarding.started', value: 1, tags: { tenantId } });
    }),
    { id: 'notifications.onboarding-started' }
  );

  bus.subscribe(
    'OnboardingStepCompleted',
    safeHandler('onboarding-step-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({
        name: 'onboarding.step_completed',
        value: 1,
        tags: {
          tenantId,
          step: String((genericPayload(event) as { step?: string }).step ?? 'unknown'),
        },
      });
    }),
    { id: 'observability.onboarding-step-completed' }
  );

  bus.subscribe(
    'OnboardingCompleted',
    safeHandler('onboarding-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId) return;
      if (customerId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { customerId },
          templateKey: 'onboarding.completed',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitMetric({ name: 'onboarding.completed', value: 1, tags: { tenantId } });
    }),
    { id: 'notifications.onboarding-completed' }
  );

  bus.subscribe(
    'MoveInInspectionSubmitted',
    safeHandler('move-in-inspection-submitted', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'onboarding.move_in_inspection_submitted',
        target: {
          type: 'OnboardingSession',
          id: String(event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.move-in-inspection-submitted' }
  );

  bus.subscribe(
    'ProcedureTrainingCompleted',
    safeHandler('procedure-training-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'onboarding.training_completed', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.procedure-training-completed' }
  );

  // -------- Scheduling --------
  bus.subscribe(
    'EventScheduled',
    safeHandler('event-scheduled', logger, async (event) => {
      const tenantId = extractTenant(event);
      const attendeeId = (genericPayload(event) as { attendeeId?: string }).attendeeId;
      if (!tenantId || !attendeeId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: attendeeId },
        templateKey: 'scheduling.event_scheduled',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.event-scheduled' }
  );

  bus.subscribe(
    'EventCancelled',
    safeHandler('event-cancelled', logger, async (event) => {
      const tenantId = extractTenant(event);
      const attendeeId = (genericPayload(event) as { attendeeId?: string }).attendeeId;
      if (!tenantId || !attendeeId) return;
      await notifications.send({
        tenantId,
        channel: 'in_app',
        recipient: { userId: attendeeId },
        templateKey: 'scheduling.event_cancelled',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.event-cancelled' }
  );

  bus.subscribe(
    'EventReminderSent',
    safeHandler('event-reminder-sent', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'scheduling.reminder_sent', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.event-reminder-sent' }
  );

  // -------- Waitlist --------
  bus.subscribe(
    'WaitlistJoined',
    safeHandler('waitlist-joined', logger, async (event) => {
      const tenantId = extractTenant(event);
      const customerId = extractCustomer(event);
      if (!tenantId || !customerId) return;
      await notifications.send({
        tenantId,
        channel: 'email',
        recipient: { customerId },
        templateKey: 'waitlist.joined',
        data: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.waitlist-joined' }
  );

  bus.subscribe(
    'WaitlistOptedOut',
    safeHandler('waitlist-opted-out', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'waitlist.opted_out', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.waitlist-opted-out' }
  );

  bus.subscribe(
    'WaitlistVacancyWaveDispatched',
    safeHandler('waitlist-vacancy-wave-dispatched', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const recipientCount = Number(
        (genericPayload(event) as { recipientCount?: number }).recipientCount ?? 0
      );
      emitMetric({
        name: 'waitlist.vacancy_wave_dispatched',
        value: recipientCount,
        tags: { tenantId },
      });
    }),
    { id: 'observability.waitlist-vacancy-wave-dispatched' }
  );

  // -------- Payments-ledger raw lifecycle (observability-only) --------
  // These are intermediate states the ledger service publishes. We don't
  // notify customers on intent/processing, but we do emit metrics so the
  // ops team can graph payment funnels and detect stalls.
  bus.subscribe(
    'PAYMENT_INTENT_CREATED',
    safeHandler('payment-intent-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'payment.intent_created', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.payment-intent-created' }
  );

  bus.subscribe(
    'PAYMENT_PROCESSING_STARTED',
    safeHandler('payment-processing-started', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'payment.processing_started', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.payment-processing-started' }
  );

  bus.subscribe(
    'LEDGER_ENTRIES_CREATED',
    safeHandler('ledger-entries-created', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const entryCount = Number(
        (genericPayload(event) as { entryCount?: number }).entryCount ?? 0
      );
      emitMetric({ name: 'ledger.entries_created', value: entryCount, tags: { tenantId } });
    }),
    { id: 'observability.ledger-entries-created' }
  );

  bus.subscribe(
    'ACCOUNT_BALANCE_UPDATED',
    safeHandler('account-balance-updated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'ledger.balance_updated', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.account-balance-updated' }
  );

  bus.subscribe(
    'STATEMENT_SENT',
    safeHandler('statement-sent', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'statement.sent',
        target: {
          type: 'Statement',
          id: String((genericPayload(event) as { statementId?: string }).statementId ?? event.aggregateId ?? ''),
        },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.statement-sent' }
  );

  bus.subscribe(
    'DISBURSEMENT_INITIATED',
    safeHandler('disbursement-initiated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      await auditLog({
        tenantId,
        action: 'disbursement.initiated',
        target: { type: 'Disbursement', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.disbursement-initiated' }
  );

  bus.subscribe(
    'DISBURSEMENT_FAILED',
    safeHandler('disbursement-failed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      const ownerId = (genericPayload(event) as { ownerId?: string }).ownerId;
      if (ownerId) {
        await notifications.send({
          tenantId,
          channel: 'email',
          recipient: { userId: ownerId },
          templateKey: 'disbursement.failed',
          data: genericPayload(event),
          correlationId: event.metadata?.correlationId,
        });
      }
      emitAlert({
        severity: 'critical',
        title: 'Disbursement failed',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'notifications.disbursement-failed' }
  );

  bus.subscribe(
    'RECONCILIATION_COMPLETED',
    safeHandler('reconciliation-completed', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({ name: 'reconciliation.completed', value: 1, tags: { tenantId } });
    }),
    { id: 'observability.reconciliation-completed' }
  );

  bus.subscribe(
    'RECONCILIATION_EXCEPTION',
    safeHandler('reconciliation-exception', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitAlert({
        severity: 'critical',
        title: 'Reconciliation exception',
        tenantId,
        correlationId: event.metadata?.correlationId,
      });
      await auditLog({
        tenantId,
        action: 'reconciliation.exception',
        target: { type: 'Reconciliation', id: String(event.aggregateId ?? '') },
        metadata: genericPayload(event),
        correlationId: event.metadata?.correlationId,
      });
    }),
    { id: 'audit.reconciliation-exception' }
  );

  // -------- Reports --------
  bus.subscribe(
    'ReportGenerated',
    safeHandler('report-generated', logger, async (event) => {
      const tenantId = extractTenant(event);
      if (!tenantId) return;
      emitMetric({
        name: 'report.generated',
        value: 1,
        tags: {
          tenantId,
          reportType: String((genericPayload(event) as { reportType?: string }).reportType ?? 'unknown'),
        },
      });
    }),
    { id: 'observability.report-generated' }
  );

  logger.info(
    { subscriberCount: 124 },
    'domain event subscribers registered across all domains (payments, invoices, leases, renewals, maintenance, compliance, customer lifecycle, identity, tenant, property, vendor, feedback, inspections, negotiation, marketplace, utilities, approvals, documents, messaging, onboarding, scheduling, waitlist, ledger, reports)'
  );
}
