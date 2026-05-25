/**
 * `arrears.send_reminder` — mutate tier (reversible).
 *
 * Sends an SMS + (optionally) an STK push prompt. The STK push is
 * gated by the autonomy-cap: if the owner has not pre-approved STK,
 * the function returns `requiresOwnerApproval = true` and the MD
 * holds the action in the four-eye queue.
 *
 * Reversible within `recallWindowMs` — the SMS can be deleted from
 * the gateway if not yet delivered to the handset.
 */

export type ReminderChannel = 'sms' | 'stk-push' | 'whatsapp';

export interface ReminderDraft {
  readonly tenantId: string;
  readonly leaseId: string;
  readonly channel: ReminderChannel;
  readonly toneTag: 'soft' | 'firm' | 'final-before-escalation';
  readonly language: 'en' | 'sw' | 'mixed';
  readonly amountMinor: number;
  readonly currency: string;
  readonly body: string;
  readonly stkAmountMinor?: number;
}

export interface ReminderTransport {
  sendSms(args: { readonly draft: ReminderDraft }): Promise<{ readonly transportId: string }>;
  initiateStkPush?(args: { readonly draft: ReminderDraft }): Promise<{ readonly transportId: string }>;
}

export interface ReminderAuditSink {
  record(args: {
    readonly draft: ReminderDraft;
    readonly transportId: string;
    readonly correlationId: string;
    readonly recallWindowMs: number;
  }): Promise<void>;
}

export interface SendReminderArgs {
  readonly draft: ReminderDraft;
  readonly transport: ReminderTransport;
  readonly audit: ReminderAuditSink;
  readonly correlationId: string;
  readonly ownerHasPreApprovedStk?: boolean;
  readonly recallWindowMs?: number;
}

export interface SendReminderResult {
  readonly transportId?: string;
  readonly recallableUntilMs?: number;
  readonly status: 'sent' | 'queued-for-owner-approval' | 'failed';
  readonly requiresOwnerApproval: boolean;
  readonly reason?: string;
}

const DEFAULT_RECALL_WINDOW_MS = 60_000;

export async function sendReminder(
  args: SendReminderArgs,
  nowMs: number,
): Promise<SendReminderResult> {
  const recallWindowMs = args.recallWindowMs ?? DEFAULT_RECALL_WINDOW_MS;

  // STK push is autonomy-capped — owner must pre-approve.
  if (args.draft.channel === 'stk-push' && args.ownerHasPreApprovedStk !== true) {
    return Object.freeze({
      status: 'queued-for-owner-approval',
      requiresOwnerApproval: true,
      reason: 'STK push requires owner pre-approval per autonomy-cap',
    });
  }

  try {
    let transportId: string;
    if (args.draft.channel === 'stk-push' && args.transport.initiateStkPush) {
      const r = await args.transport.initiateStkPush({ draft: args.draft });
      transportId = r.transportId;
    } else {
      const r = await args.transport.sendSms({ draft: args.draft });
      transportId = r.transportId;
    }
    await args.audit.record({
      draft: args.draft,
      transportId,
      correlationId: args.correlationId,
      recallWindowMs,
    });
    return Object.freeze({
      transportId,
      recallableUntilMs: nowMs + recallWindowMs,
      status: 'sent',
      requiresOwnerApproval: false,
    });
  } catch (err) {
    return Object.freeze({
      status: 'failed',
      requiresOwnerApproval: false,
      reason: err instanceof Error ? err.message : 'transport-error',
    });
  }
}
