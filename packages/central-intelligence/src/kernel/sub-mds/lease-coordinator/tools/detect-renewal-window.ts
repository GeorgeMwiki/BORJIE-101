/**
 * `lease.detect_renewal_window` — read tier.
 *
 * Triggers at lease-expiry minus N days (default 60). Returns the
 * window state and the tenant context the owner needs to decide the
 * renewal stance.
 */

export type RenewalWindowState =
  | 'pre-window'
  | 'open'
  | 'closing-soon'
  | 'expired'
  | 'overdue';

export interface DetectRenewalWindowArgs {
  readonly leaseExpiresAtMs: number;
  readonly nowMs: number;
  /** Days before expiry to consider the window open. Default 60. */
  readonly preExpiryWindowDays?: number;
  /** Days before expiry to mark "closing soon". Default 14. */
  readonly closingSoonDays?: number;
}

export interface RenewalWindowResult {
  readonly state: RenewalWindowState;
  readonly daysUntilExpiry: number;
  readonly windowOpensAtMs: number;
  readonly closingSoonAtMs: number;
  readonly recommendedAction:
    | 'wait'
    | 'open-renewal-draft'
    | 'remind-owner-decision'
    | 'mark-overdue';
}

const DEFAULT_PRE_WINDOW_DAYS = 60;
const DEFAULT_CLOSING_SOON_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function detectRenewalWindow(args: DetectRenewalWindowArgs): RenewalWindowResult {
  const preWindowDays = args.preExpiryWindowDays ?? DEFAULT_PRE_WINDOW_DAYS;
  const closingSoonDays = args.closingSoonDays ?? DEFAULT_CLOSING_SOON_DAYS;
  const windowOpensAtMs = args.leaseExpiresAtMs - preWindowDays * DAY_MS;
  const closingSoonAtMs = args.leaseExpiresAtMs - closingSoonDays * DAY_MS;
  const daysUntilExpiry = Math.floor((args.leaseExpiresAtMs - args.nowMs) / DAY_MS);

  let state: RenewalWindowState;
  let recommendedAction: RenewalWindowResult['recommendedAction'];
  if (args.nowMs < windowOpensAtMs) {
    state = 'pre-window';
    recommendedAction = 'wait';
  } else if (args.nowMs < closingSoonAtMs) {
    state = 'open';
    recommendedAction = 'open-renewal-draft';
  } else if (args.nowMs < args.leaseExpiresAtMs) {
    state = 'closing-soon';
    recommendedAction = 'remind-owner-decision';
  } else if (daysUntilExpiry >= -7) {
    state = 'expired';
    recommendedAction = 'remind-owner-decision';
  } else {
    state = 'overdue';
    recommendedAction = 'mark-overdue';
  }

  return Object.freeze({
    state,
    daysUntilExpiry,
    windowOpensAtMs,
    closingSoonAtMs,
    recommendedAction,
  });
}
