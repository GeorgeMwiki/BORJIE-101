/**
 * `maintenance.follow_up` — read tier.
 *
 * Polls the work-order state and prepares a tenant-facing feedback
 * request once the vendor reports completion. The follow-up message
 * itself is DRAFTED and queued for owner review (no auto-send) —
 * Tier-A means human in the loop.
 */

export type WorkOrderState =
  | 'dispatched'
  | 'vendor-acknowledged'
  | 'on-site'
  | 'resolved'
  | 'no-show'
  | 'cancelled';

export interface WorkOrderStatusPort {
  readState(args: {
    readonly transportId: string;
  }): Promise<{ readonly state: WorkOrderState; readonly resolvedAtMs?: number }>;
}

export interface FollowUpDraft {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly tone: 'neutral' | 'apologetic' | 'celebratory';
  readonly body: string;
  readonly draftStatus: 'queued-for-review';
}

export interface FollowUpArgs {
  readonly status: WorkOrderStatusPort;
  readonly transportId: string;
  readonly tenantId: string;
  readonly ticketId: string;
  readonly language: 'en' | 'sw' | 'mixed';
  readonly nowMs: number;
}

export interface FollowUpResult {
  readonly state: WorkOrderState;
  readonly draft?: FollowUpDraft;
  readonly action: 'wait' | 'follow-up-tenant' | 'escalate-no-show';
}

export async function followUp(args: FollowUpArgs): Promise<FollowUpResult> {
  const status = await args.status.readState({ transportId: args.transportId });
  if (status.state === 'resolved') {
    return Object.freeze({
      state: status.state,
      draft: Object.freeze({
        tenantId: args.tenantId,
        ticketId: args.ticketId,
        tone: 'celebratory',
        body: renderBody(args.language, 'resolved', args.ticketId),
        draftStatus: 'queued-for-review',
      }),
      action: 'follow-up-tenant',
    });
  }
  if (status.state === 'no-show' || status.state === 'cancelled') {
    return Object.freeze({
      state: status.state,
      draft: Object.freeze({
        tenantId: args.tenantId,
        ticketId: args.ticketId,
        tone: 'apologetic',
        body: renderBody(args.language, 'no-show', args.ticketId),
        draftStatus: 'queued-for-review',
      }),
      action: 'escalate-no-show',
    });
  }
  return Object.freeze({ state: status.state, action: 'wait' });
}

function renderBody(lang: 'en' | 'sw' | 'mixed', kind: 'resolved' | 'no-show', ticketId: string): string {
  if (lang === 'sw') {
    if (kind === 'resolved') {
      return `Habari, tiketi ${ticketId} imekamilika. Tafadhali kagua kazi na ujibu kama kuna jambo lingine.`;
    }
    return `Habari, samahani kwa kuchelewa kwa tiketi ${ticketId}. Tunashughulikia upya.`;
  }
  if (kind === 'resolved') {
    return `Hello — ticket ${ticketId} is reported complete. Please confirm the work and let us know if anything is still outstanding.`;
  }
  return `Hello — we are sorry for the delay on ticket ${ticketId}. We are re-dispatching now.`;
}
