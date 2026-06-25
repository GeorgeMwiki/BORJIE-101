/**
 * Per-licence COCKPIT projection (OW-5).
 *
 * Pure functions that turn the REAL `licences` row + its `licence_events`
 * (+ linked site name + royalty-payment ledger lines) into the
 * `LicenceCockpitData` shape the owner-web licence surface consumes
 * (apps/owner-web/src/lib/types/licence.ts). No IO here — the route does the
 * Drizzle reads and hands rows to these helpers, so they stay unit-testable.
 *
 * What is REAL vs DERIVED (honesty — CLAUDE.md):
 *   - dormancyScore        REAL — the `licences.dormancy_score` column.
 *   - payments             REAL — derived from `licence_events` of kind
 *                          payment_due / renewal_due that carry an amount,
 *                          plus their status (paid|overdue|due) inferred from
 *                          the event status + due date.
 *   - renewal window       DERIVED from `expiry_date` (window opens
 *                          RENEWAL_WINDOW_DAYS before expiry, closes at
 *                          expiry). Honest empty strings when no expiry set.
 *   - renewalPackCompletePct / missing  DERIVED from the `obligations` jsonb
 *                          checklist (each truthy key = satisfied).
 */

export type LicenceCockpitMineral = 'gold' | 'coltan' | 'tanzanite';

export interface LicenceCockpitPayment {
  readonly date: string;
  readonly description: string;
  readonly amountTzs: number;
  readonly status: 'paid' | 'overdue' | 'due';
}

export interface LicenceCockpitData {
  readonly id: string;
  readonly reference: string;
  readonly mineral: LicenceCockpitMineral;
  readonly siteName: string;
  readonly windowOpensAt: string;
  readonly windowClosesAt: string;
  readonly daysToWindow: number;
  readonly dormancyScore: number;
  readonly dormancyCitation: string;
  readonly payments: ReadonlyArray<LicenceCockpitPayment>;
  readonly renewalPackCompletePct: number;
  readonly renewalPackMissing: ReadonlyArray<string>;
}

/** Days before expiry the statutory renewal window opens. */
export const RENEWAL_WINDOW_DAYS = 90;

/**
 * The canonical renewal-pack checklist keys we score completeness against.
 * Each is a logical obligation the owner must satisfy before a renewal
 * filing. We score against whatever the licence's `obligations` jsonb
 * declares truthy; any of these keys NOT truthy is reported missing.
 *
 * WIRE STAYS LOCALE-NEUTRAL: `renewalPackMissing` carries these stable KEYS,
 * never single-language labels. owner-web RenewalActions maps each key to an
 * owner-facing label in the active locale ({ en, sw }) via pickByLocale.
 */
const RENEWAL_PACK_KEYS: ReadonlyArray<string> = [
  'epp',
  'eia',
  'community_benefit',
  'annual_fee_paid',
  'production_returns',
];

/**
 * Map the DB mineral token (Au|Cu|tanzanite|gold|…) onto the FE's 3-value
 * enum. Best-effort: gold-bearing → gold, tanzanite → tanzanite, everything
 * else → coltan (the FE's only non-gold/non-tanzanite bucket).
 */
export function mapMineral(raw: string | null | undefined): LicenceCockpitMineral {
  const v = (raw ?? '').trim().toLowerCase();
  if (v.includes('au') || v.includes('gold')) return 'gold';
  if (v.includes('tanzanite')) return 'tanzanite';
  return 'coltan';
}

/** Whole-day difference (UTC) from `now` to `target` (target − now). */
export function daysBetween(now: Date, target: Date): number {
  const ms = target.getTime() - now.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

interface RenewalWindow {
  readonly windowOpensAt: string;
  readonly windowClosesAt: string;
  readonly daysToWindow: number;
}

/**
 * Compute the renewal window from the licence expiry date. The window opens
 * RENEWAL_WINDOW_DAYS before expiry and closes at expiry. `daysToWindow` is
 * the whole-day countdown to the window OPENING (0 once it is open / past).
 * Returns honest empty strings + 0 when there is no expiry on record.
 */
export function computeRenewalWindow(
  expiryDate: string | null,
  now: Date,
): RenewalWindow {
  if (!expiryDate) {
    return { windowOpensAt: '', windowClosesAt: '', daysToWindow: 0 };
  }
  const closes = new Date(`${expiryDate}T00:00:00.000Z`);
  if (Number.isNaN(closes.getTime())) {
    return { windowOpensAt: '', windowClosesAt: '', daysToWindow: 0 };
  }
  const opens = new Date(closes.getTime());
  opens.setUTCDate(opens.getUTCDate() - RENEWAL_WINDOW_DAYS);
  const days = daysBetween(now, opens);
  return {
    windowOpensAt: opens.toISOString(),
    windowClosesAt: closes.toISOString(),
    daysToWindow: Math.max(days, 0),
  };
}

/** A licence_events row, narrowed to the columns this projection needs. */
export interface LicenceEventInput {
  readonly kind: string;
  readonly summary: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly payload: Record<string, unknown> | null;
  readonly closedAt: Date | string | null;
  readonly createdAt: Date | string;
}

function toAmountTzs(payload: Record<string, unknown> | null): number | null {
  if (!payload) return null;
  const raw =
    payload.amount_tzs ?? payload.amountTzs ?? payload.feePaidTzs ?? payload.fee_tzs;
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive the payment rows from the licence's money-bearing events. We treat
 * events of kind `payment_due` / `renewal_due` (or any event carrying an
 * amount) as payment line items. Status:
 *   - paid    : event completed / has a closedAt.
 *   - overdue : not paid AND dueDate is in the past.
 *   - due     : not paid AND dueDate is today/future (or unknown).
 */
export function derivePayments(
  events: ReadonlyArray<LicenceEventInput>,
  now: Date,
): ReadonlyArray<LicenceCockpitPayment> {
  const out: LicenceCockpitPayment[] = [];
  for (const e of events) {
    const amount = toAmountTzs(e.payload);
    const isMoneyEvent =
      e.kind === 'payment_due' || e.kind === 'renewal_due' || amount !== null;
    if (!isMoneyEvent || amount === null) continue;

    const paid = e.status === 'completed' || e.closedAt !== null;
    let status: LicenceCockpitPayment['status'];
    if (paid) {
      status = 'paid';
    } else if (e.dueDate && new Date(`${e.dueDate}T00:00:00.000Z`) < now) {
      status = 'overdue';
    } else {
      status = 'due';
    }

    const date =
      (paid && e.closedAt
        ? new Date(e.closedAt).toISOString()
        : e.dueDate
          ? new Date(`${e.dueDate}T00:00:00.000Z`).toISOString()
          : new Date(e.createdAt).toISOString());

    out.push({
      date,
      description: e.summary ?? humaniseEventKind(e.kind),
      amountTzs: amount,
      status,
    });
  }
  // Newest first.
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function humaniseEventKind(kind: string): string {
  return kind
    .split('_')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

interface RenewalPack {
  readonly renewalPackCompletePct: number;
  readonly renewalPackMissing: ReadonlyArray<string>;
}

/**
 * Score the renewal pack against the `obligations` jsonb. A key is satisfied
 * when its value is truthy (e.g. `true`, a date string, an evidence id).
 * Returns the percent complete (0–100, integer) and the stable KEYS of the
 * missing items (locale-neutral — owner-web localizes each key for display).
 */
export function computeRenewalPack(
  obligations: Record<string, unknown> | null,
): RenewalPack {
  const obl = obligations ?? {};
  const missing: string[] = [];
  let satisfied = 0;
  for (const key of RENEWAL_PACK_KEYS) {
    if (obl[key]) {
      satisfied += 1;
    } else {
      missing.push(key);
    }
  }
  const pct = Math.round((satisfied / RENEWAL_PACK_KEYS.length) * 100);
  return { renewalPackCompletePct: pct, renewalPackMissing: missing };
}

/** Build a human dormancy citation from the score (high = at risk). */
export function dormancyCitation(score: number): string {
  if (score >= 70) {
    return `Dormancy score ${score}/100 — HIGH risk of statutory cancellation; file activity returns to reduce it.`;
  }
  if (score >= 40) {
    return `Dormancy score ${score}/100 — moderate inactivity; keep production / inspection events current.`;
  }
  return `Dormancy score ${score}/100 — active; no dormancy concern recorded.`;
}

export interface LicenceRowInput {
  readonly id: string;
  readonly number: string;
  readonly mineral: string;
  readonly expiryDate: string | null;
  readonly dormancyScore: number | null;
  readonly obligations: Record<string, unknown> | null;
}

/**
 * Assemble the full LicenceCockpitData projection from the licence row, its
 * linked site name, and its events. `now` is injected so tests are
 * deterministic.
 */
export function buildLicenceCockpit(args: {
  readonly licence: LicenceRowInput;
  readonly siteName: string;
  readonly events: ReadonlyArray<LicenceEventInput>;
  readonly now: Date;
}): LicenceCockpitData {
  const { licence, siteName, events, now } = args;
  const score = licence.dormancyScore ?? 0;
  const window = computeRenewalWindow(licence.expiryDate, now);
  const pack = computeRenewalPack(licence.obligations);
  return {
    id: licence.id,
    reference: licence.number,
    mineral: mapMineral(licence.mineral),
    siteName,
    windowOpensAt: window.windowOpensAt,
    windowClosesAt: window.windowClosesAt,
    daysToWindow: window.daysToWindow,
    dormancyScore: score,
    dormancyCitation: dormancyCitation(score),
    payments: derivePayments(events, now),
    renewalPackCompletePct: pack.renewalPackCompletePct,
    renewalPackMissing: pack.renewalPackMissing,
  };
}
