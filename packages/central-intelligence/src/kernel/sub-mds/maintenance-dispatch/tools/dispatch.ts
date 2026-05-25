/**
 * `maintenance.dispatch_work_order` — mutate tier (reversible).
 *
 * Sends a work order to the chosen vendor via their preferred
 * channel. Audit-logged. Reversible until the vendor confirms
 * acceptance (the kernel records a `recall_window_ms` window in
 * which the order can be withdrawn).
 *
 * The tool is implemented as a port + adapter — production wires
 * the SMS / WhatsApp / email transports; tests inject an in-memory
 * channel.
 */

export type VendorChannel = 'sms' | 'whatsapp' | 'email' | 'phone';

export interface WorkOrderDraft {
  readonly ticketId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly channel: VendorChannel;
  readonly preferredAddress: string;
  readonly subject: string;
  readonly body: string;
  readonly slaWindowMs: number;
}

export interface DispatchTransportPort {
  send(draft: WorkOrderDraft): Promise<{ readonly transportId: string }>;
}

export interface DispatchAuditSink {
  record(args: {
    readonly draft: WorkOrderDraft;
    readonly transportId: string;
    readonly recallWindowMs: number;
    readonly correlationId: string;
  }): Promise<void>;
}

export interface DispatchArgs {
  readonly draft: WorkOrderDraft;
  readonly transport: DispatchTransportPort;
  readonly audit: DispatchAuditSink;
  readonly correlationId: string;
  /** Tier-A reversibility — default 30s window before vendor
   *  ACK locks in. */
  readonly recallWindowMs?: number;
}

export interface DispatchResult {
  readonly transportId: string;
  readonly recallableUntilMs: number;
  readonly canRecall: boolean;
}

const DEFAULT_RECALL_WINDOW_MS = 30_000;

export async function dispatchWorkOrder(
  args: DispatchArgs,
  nowMs: number,
): Promise<DispatchResult> {
  const recallWindowMs = args.recallWindowMs ?? DEFAULT_RECALL_WINDOW_MS;
  const sent = await args.transport.send(args.draft);
  await args.audit.record({
    draft: args.draft,
    transportId: sent.transportId,
    recallWindowMs,
    correlationId: args.correlationId,
  });
  return Object.freeze({
    transportId: sent.transportId,
    recallableUntilMs: nowMs + recallWindowMs,
    canRecall: true,
  });
}

/**
 * Withdraw a dispatch — only valid inside `recallableUntilMs`.
 */
export interface RecallArgs {
  readonly transportId: string;
  readonly recallableUntilMs: number;
  readonly transport: DispatchTransportPort & {
    readonly recall?: (transportId: string) => Promise<void>;
  };
  readonly audit: DispatchAuditSink;
  readonly correlationId: string;
}

export async function recallWorkOrder(
  args: RecallArgs,
  nowMs: number,
): Promise<{ readonly recalled: boolean; readonly reason?: string }> {
  if (nowMs > args.recallableUntilMs) {
    return { recalled: false, reason: 'recall-window-elapsed' };
  }
  if (args.transport.recall) {
    await args.transport.recall(args.transportId);
  }
  return { recalled: true };
}
