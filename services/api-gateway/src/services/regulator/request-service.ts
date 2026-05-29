/**
 * Regulator request service — owns the state-machine for
 * `regulator_requests` (migration 0135 / issue #194 chain C-A).
 *
 * State transitions are guarded by `RegulatorRequestService.transition`:
 *
 *   received            → parsed | rejected
 *   parsed              → owner_review | rejected
 *   owner_review        → disclosure_approved | rejected
 *   disclosure_approved → exporting
 *   exporting           → exported | rejected
 *   exported            → delivered
 *   delivered           → (terminal)
 *   rejected            → (terminal)
 *   expired             → (terminal, set by SLA cron)
 *
 * Every advancement emits a cockpit event so the owner cockpit pulses
 * live; every WRITE call appends to the audit chain through the
 * caller-supplied sink. The service is pure of side-effects beyond
 * the DB + cockpit bus + audit sink — it never touches HTTP / files
 * directly.
 *
 * Per CLAUDE.md hard rules:
 *   - Tenant scope: callers MUST bind `app.current_tenant_id` before
 *     calling this service. The service then trusts the GUC + the
 *     caller-supplied tenantId match (defensive double-check).
 *   - No `process.env` reads outside bootstrap. The service is
 *     dependency-injected by the composition root.
 *   - Pino logger only — never `console.log`.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import { regulatorRequests } from '@borjie/database';
// Types re-imported from the schemas subpath to dodge the package-
// barrel TS2709 drift (see services/api-gateway/src/middleware/
// database.ts header comment).
import type {
  NewRegulatorRequestRow,
  RegulatorKind,
  RegulatorRequestRow,
  RegulatorRequestStatus,
  RegulatorRequestSubjectKind,
} from '@borjie/database/schemas';
import { publishCockpitEvent } from '../cockpit-events/bus';

// ----------------------------------------------------------------------------
// Allowed transitions — DENY by default; mirrored in the SQL CHECK.
// ----------------------------------------------------------------------------

const TRANSITIONS: Readonly<
  Record<RegulatorRequestStatus, ReadonlySet<RegulatorRequestStatus>>
> = Object.freeze({
  received: new Set<RegulatorRequestStatus>(['parsed', 'rejected', 'expired']),
  parsed: new Set<RegulatorRequestStatus>([
    'owner_review',
    'rejected',
    'expired',
  ]),
  owner_review: new Set<RegulatorRequestStatus>([
    'disclosure_approved',
    'rejected',
    'expired',
  ]),
  disclosure_approved: new Set<RegulatorRequestStatus>([
    'exporting',
    'rejected',
  ]),
  exporting: new Set<RegulatorRequestStatus>(['exported', 'rejected']),
  exported: new Set<RegulatorRequestStatus>(['delivered']),
  delivered: new Set<RegulatorRequestStatus>(),
  rejected: new Set<RegulatorRequestStatus>(),
  expired: new Set<RegulatorRequestStatus>(),
});

export function canTransition(
  from: RegulatorRequestStatus,
  to: RegulatorRequestStatus,
): boolean {
  return TRANSITIONS[from]?.has(to) ?? false;
}

// ----------------------------------------------------------------------------
// SLA defaults — see Docs/RESEARCH/REGULATOR_SOTA_2026-05-29.md §1.
// ----------------------------------------------------------------------------

export const REGULATOR_SLA_DAYS: Readonly<Record<RegulatorKind, number>> =
  Object.freeze({
    pccb: 30,
    nemc: 14,
    eiti: 60,
    tmaa: 60,
    other: 30,
  });

// ----------------------------------------------------------------------------
// Service surface
// ----------------------------------------------------------------------------

export interface DisclosureScope {
  readonly identity?: boolean | undefined;
  readonly contact?: boolean | undefined;
  readonly employment?: boolean | undefined;
  readonly compensation?: boolean | undefined;
  readonly geo?: boolean | undefined;
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

export interface AuditSink {
  /** Append a tamper-evident audit entry; returns the row's sequence number. */
  append(entry: AuditEntryInput): Promise<{ sequenceNumber: number }>;
}

export interface AuditEntryInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly action: string;
  readonly subjectId: string;
  readonly payload: Record<string, unknown>;
}

export interface CreateRegulatorRequestInput {
  readonly tenantId: string;
  readonly regulator: RegulatorKind;
  readonly regulatorRef?: string | undefined;
  readonly subjectKind: RegulatorRequestSubjectKind;
  readonly subjectRef: string;
  readonly summarySw?: string | undefined;
  readonly summaryEn?: string | undefined;
  readonly rawRequest?: string | undefined;
  readonly createdBy: string;
  readonly dueAtOverride?: Date | undefined;
}

export interface ApproveDisclosureInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly approvedScope: DisclosureScope;
  readonly ownerId: string;
}

export interface RejectInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly reason: string;
  readonly actorId: string;
}

export interface AttachExportInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly responseDocKey: string;
  readonly responseDocUrl: string;
  readonly responseDocSha256: string;
  readonly actorId: string;
}

export interface MarkDeliveredInput {
  readonly tenantId: string;
  readonly requestId: string;
  readonly actorId: string;
}

export class RegulatorRequestStateError extends Error {
  readonly code = 'REGULATOR_REQUEST_INVALID_TRANSITION';
  constructor(
    readonly from: RegulatorRequestStatus,
    readonly to: RegulatorRequestStatus,
  ) {
    super(
      `Invalid regulator-request state transition: ${from} → ${to}. ` +
        `See services/api-gateway/src/services/regulator/request-service.ts TRANSITIONS.`,
    );
  }
}

export interface RegulatorRequestServiceDeps {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly auditSink?: AuditSink | undefined;
  readonly now?: (() => Date) | undefined;
  readonly newId?: (() => string) | undefined;
}

export class RegulatorRequestService {
  private readonly db: DbLike;
  private readonly logger: Logger;
  private readonly auditSink: AuditSink | undefined;
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(deps: RegulatorRequestServiceDeps) {
    this.db = deps.db;
    this.logger = deps.logger;
    this.auditSink = deps.auditSink;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => `rr_${randomUUID()}`);
  }

  // ---------- read ----------

  async list(
    tenantId: string,
    limit = 50,
  ): Promise<ReadonlyArray<RegulatorRequestRow>> {
    if (!tenantId) return [];
    const rows = (await this.db
      .select()
      .from(regulatorRequests as unknown as object)
      .where(eq(regulatorRequests.tenantId, tenantId))
      .limit(limit)) as readonly RegulatorRequestRow[];
    return rows;
  }

  async byId(
    tenantId: string,
    requestId: string,
  ): Promise<RegulatorRequestRow | null> {
    if (!tenantId || !requestId) return null;
    const rows = (await this.db
      .select()
      .from(regulatorRequests as unknown as object)
      .where(
        and(
          eq(regulatorRequests.tenantId, tenantId),
          eq(regulatorRequests.id, requestId),
        ),
      )
      .limit(1)) as readonly RegulatorRequestRow[];
    return rows[0] ?? null;
  }

  // ---------- write — create ----------

  async create(
    input: CreateRegulatorRequestInput,
  ): Promise<RegulatorRequestRow> {
    const id = this.newId();
    const requestedAt = this.now();
    const slaDays = REGULATOR_SLA_DAYS[input.regulator];
    const dueAt =
      input.dueAtOverride ??
      new Date(requestedAt.getTime() + slaDays * 24 * 60 * 60 * 1000);

    const row: NewRegulatorRequestRow = {
      id,
      tenantId: input.tenantId,
      regulator: input.regulator,
      regulatorRef: input.regulatorRef ?? null,
      subjectKind: input.subjectKind,
      subjectRef: input.subjectRef,
      status: 'received',
      summarySw: input.summarySw ?? null,
      summaryEn: input.summaryEn ?? null,
      approvedScope: {},
      rawRequest: input.rawRequest ?? null,
      responseDocUrl: null,
      responseDocKey: null,
      responseDocSha256: null,
      auditChainSeq: null,
      requestedAt,
      dueAt,
      ownerReviewedAt: null,
      ownerReviewedBy: null,
      exportedAt: null,
      deliveredAt: null,
      rejectedAt: null,
      rejectionReason: null,
      createdBy: input.createdBy,
    };

    const returned = (await this.db
      .insert(regulatorRequests as unknown as object)
      .values(row)
      .returning()) as readonly RegulatorRequestRow[];
    const persisted = returned[0] ?? (row as unknown as RegulatorRequestRow);

    await this.audit({
      tenantId: input.tenantId,
      actorId: input.createdBy,
      action: 'regulator.request.create',
      subjectId: id,
      payload: {
        regulator: input.regulator,
        subjectKind: input.subjectKind,
        subjectRef: input.subjectRef,
      },
    });

    publishCockpitEvent({
      kind: 'regulator.request_received',
      tenantId: input.tenantId,
      emittedAt: requestedAt.toISOString(),
      requestId: id,
      regulator: input.regulator,
      subjectKind: input.subjectKind,
      dueAt: dueAt.toISOString(),
      summaryEn: input.summaryEn ?? '',
      summarySw: input.summarySw ?? '',
    });

    return persisted;
  }

  // ---------- write — transitions ----------

  async markParsed(
    tenantId: string,
    requestId: string,
    actorId: string,
  ): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId,
      requestId,
      to: 'parsed',
      actorId,
      patch: {},
    });
  }

  async openForOwnerReview(
    tenantId: string,
    requestId: string,
    actorId: string,
  ): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId,
      requestId,
      to: 'owner_review',
      actorId,
      patch: {},
    });
  }

  async approveDisclosure(
    input: ApproveDisclosureInput,
  ): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId: input.tenantId,
      requestId: input.requestId,
      to: 'disclosure_approved',
      actorId: input.ownerId,
      patch: {
        approvedScope: input.approvedScope,
        ownerReviewedAt: this.now(),
        ownerReviewedBy: input.ownerId,
      },
    });
  }

  async markExporting(
    tenantId: string,
    requestId: string,
    actorId: string,
  ): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId,
      requestId,
      to: 'exporting',
      actorId,
      patch: {},
    });
  }

  async attachExport(
    input: AttachExportInput,
  ): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId: input.tenantId,
      requestId: input.requestId,
      to: 'exported',
      actorId: input.actorId,
      patch: {
        responseDocKey: input.responseDocKey,
        responseDocUrl: input.responseDocUrl,
        responseDocSha256: input.responseDocSha256,
        exportedAt: this.now(),
      },
    });
  }

  async markDelivered(
    input: MarkDeliveredInput,
  ): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId: input.tenantId,
      requestId: input.requestId,
      to: 'delivered',
      actorId: input.actorId,
      patch: { deliveredAt: this.now() },
    });
  }

  async reject(input: RejectInput): Promise<RegulatorRequestRow> {
    return this.transition({
      tenantId: input.tenantId,
      requestId: input.requestId,
      to: 'rejected',
      actorId: input.actorId,
      patch: {
        rejectionReason: input.reason,
        rejectedAt: this.now(),
      },
    });
  }

  // ---------- internals ----------

  private async transition(args: {
    readonly tenantId: string;
    readonly requestId: string;
    readonly to: RegulatorRequestStatus;
    readonly actorId: string;
    readonly patch: Record<string, unknown>;
  }): Promise<RegulatorRequestRow> {
    const current = await this.byId(args.tenantId, args.requestId);
    if (!current) {
      throw new Error(
        `regulator_request ${args.requestId} not found for tenant ${args.tenantId}`,
      );
    }
    const fromStatus = current.status as RegulatorRequestStatus;
    if (!canTransition(fromStatus, args.to)) {
      throw new RegulatorRequestStateError(fromStatus, args.to);
    }

    const auditSeq = await this.auditSafe({
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: `regulator.request.transition.${args.to}`,
      subjectId: args.requestId,
      payload: { from: fromStatus, to: args.to },
    });

    const patch: Record<string, unknown> = {
      ...args.patch,
      status: args.to,
      updatedAt: this.now(),
    };
    if (current.auditChainSeq == null && auditSeq != null) {
      patch.auditChainSeq = auditSeq;
    }

    const updated = (await this.db
      .update(regulatorRequests as unknown as object)
      .set(patch)
      .where(
        and(
          eq(regulatorRequests.tenantId, args.tenantId),
          eq(regulatorRequests.id, args.requestId),
        ),
      )
      .returning()) as readonly RegulatorRequestRow[];

    const next = updated[0] ?? { ...current, ...patch };

    publishCockpitEvent({
      kind: 'regulator.request_status_changed',
      tenantId: args.tenantId,
      emittedAt: new Date().toISOString(),
      requestId: args.requestId,
      fromStatus,
      toStatus: args.to,
      actorId: args.actorId,
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
        'regulator-request audit append failed',
      );
    }
  }

  private async auditSafe(
    entry: AuditEntryInput,
  ): Promise<number | null> {
    if (!this.auditSink) return null;
    try {
      const { sequenceNumber } = await this.auditSink.append(entry);
      return sequenceNumber;
    } catch (err) {
      this.logger.warn(
        { err, entry: { action: entry.action, subjectId: entry.subjectId } },
        'regulator-request audit append failed',
      );
      return null;
    }
  }
}

// ----------------------------------------------------------------------------
// Redactor — small helpers extracted from the export pipeline so the
// unit tests can exercise the redaction layer in isolation. Each
// helper returns a NEW object (no mutation) per CLAUDE.md global rule.
// ----------------------------------------------------------------------------

export interface SubjectSnapshot {
  readonly id: string;
  readonly displayName?: string | undefined;
  readonly phone?: string | undefined;
  readonly email?: string | undefined;
  readonly nationalId?: string | undefined;
  readonly siteId?: string | undefined;
  readonly role?: string | undefined;
  readonly salaryTzs?: number | undefined;
  readonly polygon?: string | undefined;
}

export function redactSubject(
  subject: SubjectSnapshot,
  scope: DisclosureScope,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: subject.id };
  if (scope.identity) {
    if (subject.displayName) out.displayName = subject.displayName;
    if (subject.nationalId) out.nationalId = maskNationalId(subject.nationalId);
  }
  if (scope.contact) {
    if (subject.phone) out.phone = maskPhone(subject.phone);
    if (subject.email) out.email = maskEmail(subject.email);
  }
  if (scope.employment) {
    if (subject.role) out.role = subject.role;
    if (subject.siteId) out.siteId = subject.siteId;
  }
  if (scope.compensation && subject.salaryTzs != null) {
    out.salaryTzs = subject.salaryTzs;
  }
  if (scope.geo && subject.polygon) {
    out.polygon = subject.polygon;
  }
  return out;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

export function maskNationalId(id: string): string {
  if (id.length < 4) return '***';
  return `***${id.slice(-4)}`;
}

// Keep `sql` import present for downstream callers that need raw
// expressions when extending this service.
void sql;
void desc;
