/**
 * Case SLA Worker
 *
 * Periodically scans overdue cases, auto-escalates up to MAX_ESCALATION_LEVEL,
 * and publishes `CaseSLABreachedEvent` once the ceiling is hit.
 *
 * Integration pattern mirrors `services/reports/src/scheduler/scheduler.ts`:
 * start/stop lifecycle + an externally-driven `tick()`. The actual CRON
 * binding (BullMQ, node-cron, k8s cronjob) lives at the edge and calls `tick`.
 *
 * Spec: Docs/analysis/SCAFFOLDED_COMPLETION.md §3.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import type { CaseRepository, CaseId } from './index.js';
import type { CaseService } from './index.js';
import type { CaseSLABreachedEvent } from './events.js';

export const MAX_ESCALATION_LEVEL = 3;

/** System actor used when the worker itself performs an escalation. */
export const SLA_SYSTEM_ACTOR = 'system:sla-worker' as UserId;

export interface CaseSLAWorkerOptions {
  readonly tenantId: TenantId;
  readonly caseRepo: CaseRepository;
  readonly caseService: CaseService;
  readonly eventBus: EventBus;
  /** Optional logger; defaults to a no-op sink. */
  readonly logger?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface TickResult {
  readonly scanned: number;
  readonly escalated: number;
  readonly breached: number;
  readonly errors: number;
}

/**
 * CaseSLAWorker
 *
 * Usage:
 *   const worker = new CaseSLAWorker({ tenantId, caseRepo, caseService, eventBus });
 *   worker.start(5 * 60 * 1000); // 5-minute CRON
 *   // ...
 *   worker.stop();
 */
export class CaseSLAWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly logger: Required<CaseSLAWorkerOptions>['logger'];

  constructor(private readonly options: CaseSLAWorkerOptions) {
    this.logger = options.logger ?? {
      info: () => undefined,
      error: () => undefined,
    };
  }

  /** Start the periodic tick. Safe to call repeatedly (idempotent). */
  start(intervalMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.safeTick();
    }, intervalMs);
  }

  /** Stop the periodic tick. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch (error) {
      this.logger.error('CaseSLAWorker tick failed', { error });
    } finally {
      this.running = false;
    }
  }

  /**
   * Single scan pass. Exported so an external scheduler can drive it directly.
   */
  async tick(): Promise<TickResult> {
    const { tenantId, caseRepo, caseService, eventBus } = this.options;
    const result: { scanned: number; escalated: number; breached: number; errors: number } = {
      scanned: 0,
      escalated: 0,
      breached: 0,
      errors: 0,
    };

    const overdue = await caseRepo.findOverdue(tenantId);
    result.scanned = overdue.length;

    for (const caseEntity of overdue) {
      try {
        if ((caseEntity.escalationLevel ?? 0) < MAX_ESCALATION_LEVEL) {
          const escalation = await caseService.escalateCase(
            caseEntity.id,
            tenantId,
            'Auto-escalated by SLA worker: overdue',
            SLA_SYSTEM_ACTOR,
            generateEventId()
          );
          if (escalation.success) {
            result.escalated += 1;
          } else {
            result.errors += 1;
            this.logger.error('SLA auto-escalate failed', {
              caseId: caseEntity.id,
              error: escalation.error,
            });
          }
        } else {
          const now = new Date().toISOString() as ISOTimestamp;
          const event: CaseSLABreachedEvent = {
            eventId: generateEventId(),
            eventType: 'CaseSLABreached',
            timestamp: now,
            tenantId,
            correlationId: generateEventId(),
            causationId: null,
            metadata: {},
            payload: {
              caseId: caseEntity.id as CaseId,
              caseNumber: caseEntity.caseNumber,
              breachedAt: now,
              escalationLevel: caseEntity.escalationLevel,
              slaHours: null,
            },
          };
          await eventBus.publish(createEventEnvelope(event, caseEntity.id, 'Case'));
          result.breached += 1;
        }
      } catch (error) {
        result.errors += 1;
        this.logger.error('SLA tick iteration failed', { caseId: caseEntity.id, error });
      }
    }

    this.logger.info('CaseSLAWorker tick complete', result);
    return result;
  }
}
