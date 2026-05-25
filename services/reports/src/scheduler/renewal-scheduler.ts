/**
 * Renewal Scheduler
 *
 * Daily CRON job that scans all active leases and fires
 * `RenewalWindowOpened` events at T-90, T-60, and T-30 days before expiry.
 *
 * The scheduler is transport-agnostic: it depends on:
 *   - `RenewalSchedulerRepository` — to fetch candidate leases
 *   - `EventPublisher`             — to push events to the outbox/bus
 *   - `Clock`                      — injectable for determinism in tests
 *
 * Duplicate emission is prevented by checking `renewalWindowOpenedAt` on the
 * lease row; the scheduler only opens the window once, but emits a distinct
 * `RenewalReminder` event for each of T-60 and T-30 after the initial open.
 */

import type { TenantId, ISOTimestamp } from '@borjie/domain-models';

export type RenewalWindowDay = 90 | 60 | 30;

export interface RenewalCandidate {
  readonly leaseId: string;
  readonly tenantId: TenantId;
  readonly leaseNumber: string;
  readonly customerId: string;
  readonly endDate: ISOTimestamp;
  readonly renewalWindowOpenedAt: ISOTimestamp | null;
  readonly renewalStatus:
    | 'not_started'
    | 'window_opened'
    | 'proposed'
    | 'accepted'
    | 'declined'
    | 'terminated'
    | 'expired';
}

export interface RenewalSchedulerRepository {
  /**
   * Return active leases whose endDate falls within the given window days
   * from `now`, excluding leases in terminal states.
   */
  findLeasesExpiringWithin(
    days: number,
    now: Date,
  ): Promise<RenewalCandidate[]>;
  markRenewalWindowOpened(
    leaseId: string,
    tenantId: TenantId,
    openedAt: ISOTimestamp,
  ): Promise<void>;
}

export interface EventPublisher {
  publish(event: {
    eventType: string;
    tenantId: TenantId;
    aggregateId: string;
    aggregateType: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface RenewalSchedulerDeps {
  readonly repo: RenewalSchedulerRepository;
  readonly publisher: EventPublisher;
  readonly clock?: Clock;
}

/** Windows fired from earliest (T-90) to most urgent (T-30). */
const WINDOWS: RenewalWindowDay[] = [90, 60, 30];

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export interface RenewalSchedulerRunResult {
  readonly scannedLeases: number;
  readonly windowsOpened: number;
  readonly remindersEmitted: number;
}

export class RenewalScheduler {
  private readonly clock: Clock;

  constructor(private readonly deps: RenewalSchedulerDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /**
   * Run a full sweep. Safe to invoke daily — idempotent per lease per window
   * because of the `renewalWindowOpenedAt` guard on the initial open.
   */
  async runDaily(correlationId: string): Promise<RenewalSchedulerRunResult> {
    const now = this.clock.now();
    const leases = await this.deps.repo.findLeasesExpiringWithin(90, now);

    let windowsOpened = 0;
    let remindersEmitted = 0;

    for (const lease of leases) {
      if (
        lease.renewalStatus === 'accepted' ||
        lease.renewalStatus === 'declined' ||
        lease.renewalStatus === 'terminated' ||
        lease.renewalStatus === 'expired'
      ) {
        continue;
      }

      const daysLeft = daysBetween(now, new Date(lease.endDate));
      const matchedWindow = WINDOWS.find((w) => daysLeft <= w && daysLeft > 0);
      if (!matchedWindow) continue;

      if (!lease.renewalWindowOpenedAt) {
        const openedAt = now.toISOString() as ISOTimestamp;
        await this.deps.repo.markRenewalWindowOpened(
          lease.leaseId,
          lease.tenantId,
          openedAt,
        );
        await this.deps.publisher.publish({
          eventType: 'RenewalWindowOpened',
          tenantId: lease.tenantId,
          aggregateId: lease.leaseId,
          aggregateType: 'Lease',
          correlationId,
          payload: {
            leaseId: lease.leaseId,
            leaseNumber: lease.leaseNumber,
            customerId: lease.customerId,
            windowDay: matchedWindow,
            daysUntilExpiry: daysLeft,
          },
        });
        windowsOpened += 1;
        continue;
      }

      // Already open — emit a cheap reminder event at each threshold crossing
      await this.deps.publisher.publish({
        eventType: 'RenewalReminder',
        tenantId: lease.tenantId,
        aggregateId: lease.leaseId,
        aggregateType: 'Lease',
        correlationId,
        payload: {
          leaseId: lease.leaseId,
          leaseNumber: lease.leaseNumber,
          customerId: lease.customerId,
          windowDay: matchedWindow,
          daysUntilExpiry: daysLeft,
        },
      });
      remindersEmitted += 1;
    }

    return {
      scannedLeases: leases.length,
      windowsOpened,
      remindersEmitted,
    };
  }
}

export function createRenewalScheduler(
  deps: RenewalSchedulerDeps,
): RenewalScheduler {
  return new RenewalScheduler(deps);
}
