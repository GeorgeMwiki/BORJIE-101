/**
 * Waitlist vacancy handler.
 *
 * Subscribes to `UnitVacatedEvent` and dispatches a priority-ordered
 * wave of outreach via the NBA queue.
 *
 * Throttling rules (from spec):
 *   - Wave size: 5 top-priority prospects per dispatch.
 *   - SLA: 1 minute from event to first wave; subsequent waves after 48h.
 *   - Opt-outs are respected: `opted_out` rows are skipped.
 *
 * The actual message rendering is delegated to the NBA queue / notifications
 * service; this handler only emits `DispatchOutreachCommand` entries and
 * appends `waitlist_outreach_events` rows for audit.
 */

import { prefixedId } from '../common/id-generator.js';
import type { DomainEvent, EventBus, EventEnvelope } from '../common/events.js';
import {
  createEventEnvelope,
  generateEventId,
} from '../common/events.js';
import type {
  TenantId,
  ISOTimestamp,
} from '@borjie/domain-models';

import {
  asWaitlistOutreachEventId,
  type UnitWaitlistEntry,
  type WaitlistChannel,
  type WaitlistOutreachEvent,
  type WaitlistOutreachRepository,
  type WaitlistRepository,
} from './types.js';

export interface UnitVacatedEventPayload {
  readonly unitId: string;
  readonly listingId?: string | null;
  readonly vacatedAt: ISOTimestamp;
  readonly reason?: string;
}

export interface OutreachDispatcher {
  dispatch(cmd: {
    readonly tenantId: TenantId;
    readonly waitlistId: string;
    readonly customerId: string;
    readonly channel: WaitlistChannel;
    readonly unitId: string;
    readonly listingId: string | null;
    readonly correlationId: string;
  }): Promise<{ readonly providerMessageId?: string } | null>;
}

export interface WaitlistVacancyHandlerConfig {
  /** Maximum prospects notified in the first wave. */
  readonly waveSize?: number;
  /** Default channel when customer has no preference. */
  readonly defaultChannel?: WaitlistChannel;
}

export interface WaitlistVacancyHandlerDeps {
  readonly repo: WaitlistRepository;
  readonly outreachRepo: WaitlistOutreachRepository;
  readonly eventBus: EventBus;
  readonly dispatcher: OutreachDispatcher;
  readonly now?: () => ISOTimestamp;
  readonly config?: WaitlistVacancyHandlerConfig;
}

function nowIso(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

export class WaitlistVacancyHandler {
  private readonly repo: WaitlistRepository;
  private readonly outreachRepo: WaitlistOutreachRepository;
  private readonly eventBus: EventBus;
  private readonly dispatcher: OutreachDispatcher;
  private readonly now: () => ISOTimestamp;
  private readonly waveSize: number;
  private readonly defaultChannel: WaitlistChannel;

  constructor(deps: WaitlistVacancyHandlerDeps) {
    this.repo = deps.repo;
    this.outreachRepo = deps.outreachRepo;
    this.eventBus = deps.eventBus;
    this.dispatcher = deps.dispatcher;
    this.now = deps.now ?? nowIso;
    this.waveSize = deps.config?.waveSize ?? 5;
    this.defaultChannel = deps.config?.defaultChannel ?? 'sms';
  }

  /**
   * Register this handler on the event bus. Call once at boot.
   */
  register(): () => void {
    interface UnitVacatedEvent extends DomainEvent {
      readonly eventType: 'UnitVacated';
      readonly payload: UnitVacatedEventPayload;
    }
    return this.eventBus.subscribe<UnitVacatedEvent>('UnitVacated', async (envelope: EventEnvelope<UnitVacatedEvent>) => {
      const payload = envelope.event.payload;
      const tenantId = envelope.event.tenantId;
      const correlationId = envelope.event.correlationId;
      await this.handleVacancy(tenantId, payload, correlationId);
    });
  }

  async handleVacancy(
    tenantId: TenantId,
    payload: UnitVacatedEventPayload,
    correlationId: string
  ): Promise<{ readonly dispatched: number; readonly skipped: number }> {
    const entries = await this.repo.listActiveForUnit(
      tenantId,
      payload.unitId
    );

    // Priority ordering (lower number = higher priority) then FIFO.
    const sorted = [...entries]
      .filter((e) => e.status === 'active')
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return (
          Date.parse(a.createdAt as unknown as string) -
          Date.parse(b.createdAt as unknown as string)
        );
      });

    const wave = sorted.slice(0, this.waveSize);

    let dispatched = 0;
    let skipped = 0;

    for (const entry of wave) {
      const channel = this.pickChannel(entry);
      const timestamp = this.now();
      try {
        const result = await this.dispatcher.dispatch({
          tenantId,
          waitlistId: entry.id,
          customerId: entry.customerId,
          channel,
          unitId: payload.unitId,
          listingId: payload.listingId ?? null,
          correlationId,
        });

        const event: WaitlistOutreachEvent = {
          id: asWaitlistOutreachEventId(prefixedId('wore')),
          tenantId,
          waitlistId: entry.id,
          eventType: 'vacancy_notified',
          channel,
          messagePayload: {
            unitId: payload.unitId,
            listingId: payload.listingId ?? null,
            vacatedAt: payload.vacatedAt,
          },
          correlationId,
          occurredAt: timestamp,
          providerMessageId: result?.providerMessageId ?? null,
          errorCode: null,
          errorMessage: null,
        };
        await this.outreachRepo.append(event);

        await this.repo.update(entry.id, tenantId, {
          lastNotifiedAt: timestamp,
          notificationCount: entry.notificationCount + 1,
          updatedAt: timestamp,
        });

        dispatched += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const event: WaitlistOutreachEvent = {
          id: asWaitlistOutreachEventId(prefixedId('wore')),
          tenantId,
          waitlistId: entry.id,
          eventType: 'delivery_failed',
          channel,
          messagePayload: { unitId: payload.unitId },
          correlationId,
          occurredAt: timestamp,
          providerMessageId: null,
          errorCode: 'DISPATCH_ERROR',
          errorMessage: message,
        };
        await this.outreachRepo.append(event);
        console.error(
          'Waitlist dispatch failed for',
          entry.id,
          ':',
          message
        );
        skipped += 1;
      }
    }

    interface WaitlistVacancyWaveDispatchedEvent extends DomainEvent {
      readonly eventType: 'WaitlistVacancyWaveDispatched';
      readonly payload: {
        readonly unitId: string;
        readonly dispatched: number;
        readonly skipped: number;
        readonly totalActive: number;
      };
    }
    const waveEvent: WaitlistVacancyWaveDispatchedEvent = {
      eventId: generateEventId(),
      eventType: 'WaitlistVacancyWaveDispatched',
      timestamp: this.now(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        unitId: payload.unitId,
        dispatched,
        skipped,
        totalActive: sorted.length,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(waveEvent, payload.unitId, 'Unit')
    );

    return { dispatched, skipped };
  }

  private pickChannel(entry: UnitWaitlistEntry): WaitlistChannel {
    if (entry.preferredChannels.length > 0) {
      return entry.preferredChannels[0]!;
    }
    return this.defaultChannel;
  }
}
