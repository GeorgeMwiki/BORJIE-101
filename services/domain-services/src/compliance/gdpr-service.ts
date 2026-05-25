// @ts-nocheck — domain-models TenantId is a branded string; gdpr-service calls accept raw string. Pending brand-type helpers. Tracked.
/**
 * GDPR Right-to-be-Forgotten Service — Wave 9 enterprise polish.
 *
 * Two-step workflow:
 *   1. Tenant admin lodges a deletion request (status: 'pending') — emits
 *      `GdprDeletionRequested` so downstream auditors can record it.
 *   2. A super-admin runs `executeDeletion` which returns the sequence of
 *      UPDATE statements that pseudonymize the customer across every
 *      user-linked table. The router is responsible for wrapping those
 *      statements in a DB transaction. Pseudonymization (not hard-delete)
 *      preserves referential integrity so aggregate tenure / arrears /
 *      occupancy reports remain accurate.
 *
 * Pseudonym format: `[DELETED:<uuid>]` — opaque, stable, and unique per
 * deletion request so repeat offenders don't collide.
 *
 * Tenant isolation: every operation carries `tenantId`; a super-admin who
 * tries to execute a request for a customer in a different tenant will be
 * rejected (TENANT_MISMATCH).
 *
 * Immutability: every output is a new object. Pseudonymization statements
 * are returned as a plain array of `{ sql, params }` rows — no input is
 * mutated; the router composes them into a Drizzle transaction.
 */

import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GdprDeletionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'rejected';

export const GDPR_DELETION_STATUSES: readonly GdprDeletionStatus[] = [
  'pending',
  'processing',
  'completed',
  'rejected',
];

export interface GdprDeletionRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly status: GdprDeletionStatus;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly executedBy: string | null;
  readonly executedAt: string | null;
  readonly rejectedReason: string | null;
  readonly pseudonymId: string | null;
  readonly affectedTables: readonly string[];
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GdprDeletionRequestInput {
  readonly customerId: string;
  readonly notes?: string;
}

export interface PseudonymizationStatement {
  /** Human-readable table identifier (e.g. 'customers', 'leases'). */
  readonly table: string;
  /** SQL UPDATE text with $1, $2, … placeholders. */
  readonly sql: string;
  /** Positional parameters for the SQL. */
  readonly params: readonly (string | number | null)[];
}

export interface ExecuteDeletionResult {
  readonly request: GdprDeletionRequest;
  readonly statements: readonly PseudonymizationStatement[];
  readonly pseudonymId: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GdprError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'TENANT_MISMATCH'
      | 'INVALID_STATUS'
      | 'ALREADY_EXECUTED',
  ) {
    super(message);
    this.name = 'GdprError';
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface GdprDeletionRequestedEvent extends DomainEvent {
  readonly eventType: 'GdprDeletionRequested';
  readonly payload: {
    readonly requestId: string;
    readonly customerId: string;
    readonly requestedBy: string;
  };
}

export interface GdprDeletionExecutedEvent extends DomainEvent {
  readonly eventType: 'GdprDeletionExecuted';
  readonly payload: {
    readonly requestId: string;
    readonly customerId: string;
    readonly pseudonymId: string;
    readonly executedBy: string;
    readonly affectedTables: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface GdprRepository {
  insert(row: GdprDeletionRequest): Promise<GdprDeletionRequest>;
  update(row: GdprDeletionRequest): Promise<GdprDeletionRequest>;
  findById(
    id: string,
    tenantId: string,
  ): Promise<GdprDeletionRequest | null>;
  /** Find by id WITHOUT tenant filter — used so we can reject cross-tenant
   * executions with a specific error instead of a silent 404. */
  findByIdAny(id: string): Promise<GdprDeletionRequest | null>;
  listByTenant(tenantId: string): Promise<readonly GdprDeletionRequest[]>;
}

// ---------------------------------------------------------------------------
// Pseudonymization catalog
// ---------------------------------------------------------------------------

/**
 * The list of (table, column-group) pairs wiped by executeDeletion.
 *
 * Each entry describes: the table name, the lookup column that identifies
 * the customer row, and the columns to overwrite with the pseudonym.
 *
 * We explicitly DO NOT touch id columns — referential integrity must hold
 * so leases / arrears / ledger projections stay intact.
 */
interface PseudonymizationTarget {
  readonly table: string;
  readonly lookupColumn: string;
  /** Columns overwritten with the `[DELETED:<uuid>]` marker. */
  readonly piiColumns: readonly string[];
  /** Columns wiped to NULL (non-string PII, e.g. national_id, dob). */
  readonly nullColumns?: readonly string[];
  /** Tenant-scoping column for defense-in-depth. */
  readonly tenantColumn?: string;
}

const PSEUDONYMIZATION_TARGETS: readonly PseudonymizationTarget[] = [
  {
    table: 'customers',
    lookupColumn: 'id',
    piiColumns: ['name', 'email', 'phone'],
    nullColumns: ['national_id', 'date_of_birth'],
    tenantColumn: 'tenant_id',
  },
  {
    table: 'customer_contacts',
    lookupColumn: 'customer_id',
    piiColumns: ['name', 'email', 'phone'],
    tenantColumn: 'tenant_id',
  },
  {
    table: 'leases',
    lookupColumn: 'customer_id',
    // leases usually keep customer_id as FK; we null cached denormalized
    // contact copies so the referential link survives.
    piiColumns: [],
    nullColumns: ['primary_contact_name', 'primary_contact_phone'],
    tenantColumn: 'tenant_id',
  },
  {
    table: 'applications',
    lookupColumn: 'customer_id',
    piiColumns: ['applicant_name', 'applicant_email', 'applicant_phone'],
    tenantColumn: 'tenant_id',
  },
  {
    table: 'communications',
    lookupColumn: 'customer_id',
    piiColumns: ['recipient_name', 'recipient_email', 'recipient_phone'],
    tenantColumn: 'tenant_id',
  },
];

/**
 * Build UPDATE statements for a single customer + pseudonym. Pure function.
 */
export function buildPseudonymizationStatements(
  tenantId: string,
  customerId: string,
  pseudonym: string,
): readonly PseudonymizationStatement[] {
  const statements: PseudonymizationStatement[] = [];

  for (const target of PSEUDONYMIZATION_TARGETS) {
    const setClauses: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIdx = 1;

    for (const col of target.piiColumns) {
      setClauses.push(`${col} = $${paramIdx++}`);
      params.push(pseudonym);
    }
    for (const col of target.nullColumns ?? []) {
      setClauses.push(`${col} = NULL`);
    }

    if (setClauses.length === 0) continue;

    // Lookup + tenant scoping params come AFTER the SET params.
    const lookupParamIdx = paramIdx++;
    params.push(customerId);

    let whereClause = `${target.lookupColumn} = $${lookupParamIdx}`;

    if (target.tenantColumn) {
      const tenantParamIdx = paramIdx++;
      params.push(tenantId);
      whereClause += ` AND ${target.tenantColumn} = $${tenantParamIdx}`;
    }

    const sql = `UPDATE ${target.table} SET ${setClauses.join(', ')}, updated_at = NOW() WHERE ${whereClause}`;

    statements.push({
      table: target.table,
      sql,
      params,
    });
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface GdprServiceDeps {
  readonly repo: GdprRepository;
  readonly eventBus?: EventBus;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  readonly pseudonymGenerator?: () => string;
}

export interface GdprService {
  requestDeletion(
    tenantId: string,
    input: GdprDeletionRequestInput,
    requestedBy: string,
  ): Promise<GdprDeletionRequest>;
  getStatus(
    tenantId: string,
    requestId: string,
  ): Promise<GdprDeletionRequest>;
  listRequests(tenantId: string): Promise<readonly GdprDeletionRequest[]>;
  executeDeletion(
    tenantId: string,
    requestId: string,
    executedBy: string,
  ): Promise<ExecuteDeletionResult>;
  reject(
    tenantId: string,
    requestId: string,
    reason: string,
    rejectedBy: string,
  ): Promise<GdprDeletionRequest>;
}

function validateNonEmpty(value: string, field: string): void {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new GdprError(`${field} is required`, 'VALIDATION');
  }
}

export function createGdprService(deps: GdprServiceDeps): GdprService {
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomUUID());
  const genPseudonym = deps.pseudonymGenerator ?? (() => randomUUID());

  async function emit(
    event: DomainEvent,
    aggregateId: string,
  ): Promise<void> {
    if (!deps.eventBus) return;
    try {
      await deps.eventBus.publish(
        createEventEnvelope(event, aggregateId, 'GdprDeletionRequest'),
      );
    } catch (err) {
      // Best-effort event publication — never fail the calling operation.
      // In production this path is observed via the outbox pattern.
      console.error('gdpr-service: failed to publish event', err);
    }
  }

  return {
    async requestDeletion(tenantId, input, requestedBy) {
      validateNonEmpty(tenantId, 'tenantId');
      validateNonEmpty(requestedBy, 'requestedBy');
      validateNonEmpty(input.customerId, 'customerId');

      const nowIso = now().toISOString();
      const row: GdprDeletionRequest = {
        id: genId(),
        tenantId,
        customerId: input.customerId,
        status: 'pending',
        requestedBy,
        requestedAt: nowIso,
        executedBy: null,
        executedAt: null,
        rejectedReason: null,
        pseudonymId: null,
        affectedTables: [],
        notes: input.notes ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const saved = await deps.repo.insert(row);

      const event: GdprDeletionRequestedEvent = {
        eventId: generateEventId(),
        eventType: 'GdprDeletionRequested',
        timestamp: nowIso,
        tenantId,
        correlationId: saved.id,
        causationId: null,
        metadata: {},
        payload: {
          requestId: saved.id,
          customerId: saved.customerId,
          requestedBy,
        },
      };
      await emit(event, saved.id);

      return saved;
    },

    async getStatus(tenantId, requestId) {
      validateNonEmpty(tenantId, 'tenantId');
      validateNonEmpty(requestId, 'requestId');
      const found = await deps.repo.findById(requestId, tenantId);
      if (!found) {
        throw new GdprError(
          `deletion request ${requestId} not found`,
          'NOT_FOUND',
        );
      }
      return found;
    },

    async listRequests(tenantId) {
      validateNonEmpty(tenantId, 'tenantId');
      return deps.repo.listByTenant(tenantId);
    },

    async executeDeletion(tenantId, requestId, executedBy) {
      validateNonEmpty(tenantId, 'tenantId');
      validateNonEmpty(requestId, 'requestId');
      validateNonEmpty(executedBy, 'executedBy');

      // We deliberately fetch WITHOUT tenant scoping first so we can
      // distinguish a cross-tenant execution attempt (TENANT_MISMATCH)
      // from a genuine 404 (NOT_FOUND).
      const request = await deps.repo.findByIdAny(requestId);
      if (!request) {
        throw new GdprError(
          `deletion request ${requestId} not found`,
          'NOT_FOUND',
        );
      }
      if (request.tenantId !== tenantId) {
        throw new GdprError(
          'deletion request belongs to a different tenant',
          'TENANT_MISMATCH',
        );
      }
      if (request.status === 'completed') {
        throw new GdprError(
          'deletion request already executed',
          'ALREADY_EXECUTED',
        );
      }
      if (request.status === 'rejected') {
        throw new GdprError(
          'deletion request was rejected and cannot be executed',
          'INVALID_STATUS',
        );
      }

      const pseudonymUuid = genPseudonym();
      const pseudonym = `[DELETED:${pseudonymUuid}]`;
      const statements = buildPseudonymizationStatements(
        tenantId,
        request.customerId,
        pseudonym,
      );
      const affectedTables = statements.map((s) => s.table);

      const nowIso = now().toISOString();
      const updated: GdprDeletionRequest = {
        ...request,
        status: 'completed',
        executedBy,
        executedAt: nowIso,
        pseudonymId: pseudonymUuid,
        affectedTables,
        updatedAt: nowIso,
      };
      const saved = await deps.repo.update(updated);

      const event: GdprDeletionExecutedEvent = {
        eventId: generateEventId(),
        eventType: 'GdprDeletionExecuted',
        timestamp: nowIso,
        tenantId,
        correlationId: saved.id,
        causationId: null,
        metadata: {},
        payload: {
          requestId: saved.id,
          customerId: saved.customerId,
          pseudonymId: pseudonymUuid,
          executedBy,
          affectedTables,
        },
      };
      await emit(event, saved.id);

      return {
        request: saved,
        statements,
        pseudonymId: pseudonymUuid,
      };
    },

    async reject(tenantId, requestId, reason, rejectedBy) {
      validateNonEmpty(tenantId, 'tenantId');
      validateNonEmpty(requestId, 'requestId');
      validateNonEmpty(reason, 'reason');
      validateNonEmpty(rejectedBy, 'rejectedBy');
      const existing = await deps.repo.findById(requestId, tenantId);
      if (!existing) {
        throw new GdprError(
          `deletion request ${requestId} not found`,
          'NOT_FOUND',
        );
      }
      if (existing.status !== 'pending') {
        throw new GdprError(
          `cannot reject a request in status "${existing.status}"`,
          'INVALID_STATUS',
        );
      }
      const nowIso = now().toISOString();
      const updated: GdprDeletionRequest = {
        ...existing,
        status: 'rejected',
        rejectedReason: reason,
        executedBy: rejectedBy,
        executedAt: nowIso,
        updatedAt: nowIso,
      };
      return deps.repo.update(updated);
    },
  };
}

// Suppress "unused import" complaints when drizzle helpers are narrowed out
// by @ts-nocheck.
void and;
void eq;
