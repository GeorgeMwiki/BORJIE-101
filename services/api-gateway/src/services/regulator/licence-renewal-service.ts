/**
 * Licence renewal service — closes chain C-B (issue #194).
 *
 * Owns the renewal state machine on `licences` + `licence_events`:
 *
 *   active (expiring soon) → draft_renewal → submitted_renewal →
 *   acknowledged → renewed.
 *
 * Behaviour:
 *   - `startRenewal` creates a `licence_events` row with kind
 *     `renewal_due`, status `in_progress`, and a payload that holds
 *     the draft body. Idempotent per `(tenantId, licenceId)` while
 *     status remains open or in_progress.
 *   - `submitRenewal` flips the event to status `completed`, records
 *     the submission reference, and (optionally) seeds the licences
 *     row update for a freshly-signed renewal certificate.
 *   - `renewalStatus` returns the current open/in-flight renewal event
 *     for the licence, or null.
 *
 * Cockpit emission + audit append happen at every state change.
 *
 * Per CLAUDE.md:
 *   - Tenant scope is the GUC-bound RLS predicate.
 *   - Forward-only — no destructive ops.
 *   - Pino logger only.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import { licenceEvents, licences } from '@borjie/database';
import type { Licence, LicenceEvent } from '@borjie/database/schemas';
import { publishCockpitEvent } from '../cockpit-events/bus';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type RenewalEventStatus =
  | 'open'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'escalated';

export interface StartRenewalInput {
  readonly tenantId: string;
  readonly licenceId: string;
  readonly actorId: string;
  readonly draftBody?: Record<string, unknown> | undefined;
  readonly summary?: string | undefined;
}

export interface SubmitRenewalInput {
  readonly tenantId: string;
  readonly licenceId: string;
  readonly actorId: string;
  readonly submissionReference: string;
  readonly evidenceDocId?: string | undefined;
  readonly renewalDocUrl?: string | undefined;
}

export interface RenewalView {
  readonly licence: Licence;
  readonly openEvent: LicenceEvent | null;
  readonly daysUntilExpiry: number | null;
  readonly stage:
    | 'no_action'
    | 'reminder'
    | 'drafting'
    | 'awaiting_owner'
    | 'submitted'
    | 'renewed';
}

export interface DbLike {
  insert(table: unknown): {
    values(row: unknown): { returning(): Promise<readonly unknown[]> };
  };
  select(): {
    from(table: unknown): {
      where(predicate: unknown): {
        orderBy?: (col: unknown) => { limit(n: number): Promise<readonly unknown[]> };
        limit(n: number): Promise<readonly unknown[]>;
      };
    };
  };
  update(table: unknown): {
    set(patch: unknown): {
      where(predicate: unknown): { returning(): Promise<readonly unknown[]> };
    };
  };
}

export interface AuditEntryInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly subjectId: string;
  readonly payload: Record<string, unknown>;
}

export interface AuditSink {
  append(entry: AuditEntryInput): Promise<{ sequenceNumber: number }>;
}

export interface LicenceRenewalServiceDeps {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly auditSink?: AuditSink | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

export const RENEWAL_REMINDER_OFFSETS_DAYS = [
  90, 60, 30, 14, 7, 1,
] as const;

export type RenewalReminderOffset =
  (typeof RENEWAL_REMINDER_OFFSETS_DAYS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function daysUntil(now: Date, when: Date | string | null): number | null {
  if (!when) return null;
  const target = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(target.getTime())) return null;
  const ms = target.getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

export function nextReminderOffset(
  days: number,
): RenewalReminderOffset | null {
  // Returns the SMALLEST offset that is still >= days. The reminder
  // ladder is descending [90, 60, 30, 14, 7, 1]; we walk it in reverse
  // so that 30 days remaining → 30 (not 90), and 89 days remaining →
  // 90 (the only band that contains it). Past-expiry (days <= 0) is
  // treated as crossed for every rung, returning the topmost band so
  // the watcher emits a "still inside the watch window" reminder.
  if (days <= 0) {
    return RENEWAL_REMINDER_OFFSETS_DAYS[0] ?? null;
  }
  let best: RenewalReminderOffset | null = null;
  for (const offset of RENEWAL_REMINDER_OFFSETS_DAYS) {
    if (days <= offset) {
      if (best == null || offset < best) best = offset;
    }
  }
  return best;
}

export function renewalStageFor(
  daysToExpiry: number | null,
  event: LicenceEvent | null,
): RenewalView['stage'] {
  if (event) {
    if (event.status === 'completed') return 'renewed';
    if (event.payload && (event.payload as Record<string, unknown>).submittedAt) {
      return 'submitted';
    }
    if (event.payload && (event.payload as Record<string, unknown>).ownerSignedAt) {
      return 'submitted';
    }
    if (event.status === 'in_progress') return 'drafting';
    if (event.status === 'open') return 'awaiting_owner';
  }
  if (daysToExpiry == null) return 'no_action';
  if (daysToExpiry <= 90) return 'reminder';
  return 'no_action';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LicenceRenewalService {
  private readonly db: DbLike;
  private readonly logger: Logger;
  private readonly auditSink: AuditSink | undefined;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: LicenceRenewalServiceDeps) {
    this.db = deps.db;
    this.logger = deps.logger;
    this.auditSink = deps.auditSink;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => `le_${randomUUID()}`);
  }

  async getLicence(
    tenantId: string,
    licenceId: string,
  ): Promise<Licence | null> {
    const rows = (await this.db
      .select()
      .from(licences as unknown as object)
      .where(
        and(eq(licences.tenantId, tenantId), eq(licences.id, licenceId)),
      )
      .limit(1)) as readonly Licence[];
    return rows[0] ?? null;
  }

  async findOpenRenewalEvent(
    tenantId: string,
    licenceId: string,
  ): Promise<LicenceEvent | null> {
    const rows = (await this.db
      .select()
      .from(licenceEvents as unknown as object)
      .where(
        and(
          eq(licenceEvents.tenantId, tenantId),
          eq(licenceEvents.licenceId, licenceId),
          eq(licenceEvents.kind, 'renewal_due'),
        ),
      )
      .limit(50)) as readonly LicenceEvent[];
    const open = rows.filter(
      (r) => r.status === 'open' || r.status === 'in_progress',
    );
    if (open.length === 0) return null;
    // Latest by createdAt.
    return open.reduce((a, b) =>
      new Date(a.createdAt).getTime() >= new Date(b.createdAt).getTime() ? a : b,
    );
  }

  async renewalStatus(
    tenantId: string,
    licenceId: string,
  ): Promise<RenewalView | null> {
    const licence = await this.getLicence(tenantId, licenceId);
    if (!licence) return null;
    const event = await this.findOpenRenewalEvent(tenantId, licenceId);
    const days = daysUntil(this.now(), licence.expiryDate as unknown as string);
    return {
      licence,
      openEvent: event,
      daysUntilExpiry: days,
      stage: renewalStageFor(days, event),
    };
  }

  async startRenewal(input: StartRenewalInput): Promise<LicenceEvent> {
    const existing = await this.findOpenRenewalEvent(
      input.tenantId,
      input.licenceId,
    );
    if (existing) {
      return existing;
    }
    const licence = await this.getLicence(input.tenantId, input.licenceId);
    if (!licence) {
      throw new Error(
        `licence ${input.licenceId} not found for tenant ${input.tenantId}`,
      );
    }
    const id = this.newId();
    const now = this.now();
    const days = daysUntil(now, licence.expiryDate as unknown as string);
    const row = {
      id,
      tenantId: input.tenantId,
      licenceId: input.licenceId,
      kind: 'renewal_due',
      summary: input.summary ?? `Renewal drafted for ${licence.number}`,
      dueDate: licence.expiryDate ?? null,
      status: 'in_progress' as RenewalEventStatus,
      payload: {
        ...(input.draftBody ?? {}),
        draftStartedAt: now.toISOString(),
        draftedBy: input.actorId,
      },
      evidenceIds: [] as string[],
      createdAt: now,
      closedAt: null,
    };

    const returned = (await this.db
      .insert(licenceEvents as unknown as object)
      .values(row)
      .returning()) as readonly LicenceEvent[];
    const persisted = returned[0] ?? (row as unknown as LicenceEvent);

    await this.audit({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'licence.renewal.start',
      subjectId: input.licenceId,
      payload: { eventId: id, daysUntilExpiry: days },
    });

    publishCockpitEvent({
      kind: 'licence.renewal_status_changed',
      tenantId: input.tenantId,
      emittedAt: now.toISOString(),
      licenceId: input.licenceId,
      licenceEventId: id,
      fromStatus: 'active',
      toStatus: 'drafting',
      daysUntilExpiry: days,
    });

    return persisted;
  }

  async submitRenewal(input: SubmitRenewalInput): Promise<LicenceEvent> {
    const existing = await this.findOpenRenewalEvent(
      input.tenantId,
      input.licenceId,
    );
    if (!existing) {
      throw new Error(
        `no open renewal_due event for licence ${input.licenceId}`,
      );
    }

    const now = this.now();
    const evidence = input.evidenceDocId
      ? Array.from(new Set([...existing.evidenceIds, input.evidenceDocId]))
      : existing.evidenceIds;

    const patch = {
      status: 'completed' as RenewalEventStatus,
      payload: {
        ...(existing.payload as Record<string, unknown>),
        submittedAt: now.toISOString(),
        submittedBy: input.actorId,
        submissionReference: input.submissionReference,
        renewalDocUrl: input.renewalDocUrl ?? null,
      },
      evidenceIds: evidence,
      closedAt: now,
    };

    const updated = (await this.db
      .update(licenceEvents as unknown as object)
      .set(patch)
      .where(
        and(
          eq(licenceEvents.tenantId, input.tenantId),
          eq(licenceEvents.id, existing.id),
        ),
      )
      .returning()) as readonly LicenceEvent[];

    const next = updated[0] ?? ({ ...existing, ...patch } as LicenceEvent);

    if (input.renewalDocUrl) {
      // Stamp renewal_doc_url onto the licence's fees JSON (no
      // dedicated column — we surface via `licences.fees.renewal_doc_url`
      // which keeps the migration small).
      const licence = await this.getLicence(input.tenantId, input.licenceId);
      const fees = (licence?.fees ?? {}) as Record<string, unknown>;
      await this.db
        .update(licences as unknown as object)
        .set({
          fees: { ...fees, renewal_doc_url: input.renewalDocUrl },
          updatedAt: now,
        })
        .where(
          and(
            eq(licences.tenantId, input.tenantId),
            eq(licences.id, input.licenceId),
          ),
        )
        .returning();
    }

    await this.audit({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: 'licence.renewal.submit',
      subjectId: input.licenceId,
      payload: {
        eventId: existing.id,
        submissionReference: input.submissionReference,
      },
    });

    publishCockpitEvent({
      kind: 'licence.renewal_status_changed',
      tenantId: input.tenantId,
      emittedAt: now.toISOString(),
      licenceId: input.licenceId,
      licenceEventId: existing.id,
      fromStatus: 'drafting',
      toStatus: 'submitted',
      daysUntilExpiry: daysUntil(now, next.dueDate as unknown as string),
    });

    return next;
  }

  private async audit(entry: AuditEntryInput): Promise<void> {
    if (!this.auditSink) return;
    try {
      await this.auditSink.append(entry);
    } catch (err) {
      this.logger.warn(
        { err, entry: { action: entry.action, subjectId: entry.subjectId } },
        'licence-renewal audit append failed',
      );
    }
  }
}

// Reserve raw-SQL imports for future expansion (e.g. PostGIS
// re-projection of renewal polygons before regulator upload).
void asc;
void desc;
void sql;
