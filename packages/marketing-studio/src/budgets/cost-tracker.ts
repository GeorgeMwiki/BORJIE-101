/**
 * Cost tracker — per spec §10.
 *
 * Reserve / commit / release semantics. Pure in-memory; persistence
 * is the caller's responsibility (typically `marketing_telemetry_events`
 * or a dedicated cost table joined into the run).
 *
 * Budgets are per asset class. Exceeding the ceiling raises a
 * MarketingError(BUDGET_EXCEEDED) from `commit`.
 */

import type { MarketingClass } from '../types.js';
import { MarketingError } from '../types.js';

export const COST_CEILINGS_USD: Readonly<Record<MarketingClass, number>> =
  Object.freeze({
    social_post_single: 0.3,
    social_thread: 0.5,
    short_video_spot: 2.0,
    long_video_story: 15.0,
    paid_ad_creative: 5.0,
    email_campaign: 0.8,
    landing_page: 3.0,
    seo_article: 1.0,
    press_release: 1.5,
    investor_one_pager: 2.0,
    buyer_brochure: 3.0,
    booth_event_kit: 20.0,
  });

export const LATENCY_CEILINGS_SEC: Readonly<Record<MarketingClass, number>> =
  Object.freeze({
    social_post_single: 60,
    social_thread: 120,
    short_video_spot: 300,
    long_video_story: 1800,
    paid_ad_creative: 600,
    email_campaign: 90,
    landing_page: 300,
    seo_article: 180,
    press_release: 300,
    investor_one_pager: 300,
    buyer_brochure: 600,
    booth_event_kit: 3600,
  });

export interface Reservation {
  readonly asset_class: MarketingClass;
  readonly reserved_usd: number;
  readonly reserved_at: string;
}

export interface CommitArgs {
  readonly asset_class: MarketingClass;
  readonly actual_usd: number;
}

export class CostTracker {
  readonly #reservations: Map<string, Reservation> = new Map();

  public reserve(asset_class: MarketingClass): Reservation {
    const ceiling = COST_CEILINGS_USD[asset_class];
    const reservation: Reservation = {
      asset_class,
      reserved_usd: ceiling,
      reserved_at: new Date().toISOString(),
    };
    this.#reservations.set(reservationKey(asset_class, reservation.reserved_at), reservation);
    return reservation;
  }

  public commit(args: CommitArgs): void {
    const ceiling = COST_CEILINGS_USD[args.asset_class];
    if (args.actual_usd > ceiling) {
      throw new MarketingError(
        'BUDGET_EXCEEDED',
        `actual cost ${args.actual_usd} exceeds ceiling ${ceiling} for ${args.asset_class}`,
        [args.asset_class, String(args.actual_usd), String(ceiling)],
      );
    }
  }

  public release(reservation: Reservation): void {
    this.#reservations.delete(
      reservationKey(reservation.asset_class, reservation.reserved_at),
    );
  }

  public outstanding(): ReadonlyArray<Reservation> {
    return Array.from(this.#reservations.values());
  }
}

function reservationKey(cls: MarketingClass, iso: string): string {
  return `${cls}@${iso}`;
}
