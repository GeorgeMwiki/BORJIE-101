/**
 * Tenant Credit Rating Service.
 *
 * Orchestrates real payment data into a CreditRating. The service is a
 * thin coordinator — it delegates to injected repository ports so the
 * scoring remains testable in isolation and no hardcoded weights or
 * synthetic data leak in. Wiring to the real database is done by the
 * domain-services layer.
 *
 * Surfaces:
 *   computeRating(tenantId, customerId)
 *   recomputeAll(tenantId)
 *   recordPromiseOutcome(tenantId, customerId, outcome)
 *   getHistory(tenantId, customerId, months)
 */

import { v4 as uuid } from 'uuid';
import {
  CreditRating,
  CreditRatingHistoryEntry,
  CreditRatingInputs,
  DEFAULT_GRADING_WEIGHTS,
  GradingWeights,
  PromiseKind,
  PromiseOutcome,
  PromiseOutcomeRecord,
  CreditSharingOptIn,
} from './credit-rating-types.js';
import { scoreTenantCredit } from './scoring-model.js';

export interface CreditRatingRepository {
  /** Pull live scoring inputs from payments / invoices / cases / leases. */
  loadInputs(
    tenantId: string,
    customerId: string,
    asOf: string,
  ): Promise<CreditRatingInputs | null>;

  /** Enumerate every customer in a tenant (for recomputeAll). */
  listCustomerIds(tenantId: string): Promise<readonly string[]>;

  /** Persist a rating snapshot. Append-only. */
  saveSnapshot(rating: CreditRating): Promise<void>;

  /** Load historical snapshots bounded by months. */
  listHistory(
    tenantId: string,
    customerId: string,
    months: number,
  ): Promise<readonly CreditRatingHistoryEntry[]>;

  /** Append a promise outcome. */
  savePromiseOutcome(record: PromiseOutcomeRecord): Promise<void>;

  /** Load weights for a tenant (null → caller uses defaults). */
  loadWeights(tenantId: string): Promise<GradingWeights | null>;

  /** Save tenant-level weights. */
  saveWeights(tenantId: string, weights: GradingWeights): Promise<void>;

  /** Record a sharing opt-in. */
  saveSharingOptIn(optIn: CreditSharingOptIn): Promise<void>;

  /** Revoke a sharing opt-in by id. */
  revokeSharingOptIn(
    tenantId: string,
    customerId: string,
    optInId: string,
  ): Promise<void>;

  /** List active opt-ins for a customer. */
  listSharingOptIns(
    tenantId: string,
    customerId: string,
  ): Promise<readonly CreditSharingOptIn[]>;
}

export interface CreditRatingServiceDeps {
  readonly repo: CreditRatingRepository;
  readonly clock?: () => string;
  readonly logger?: {
    info(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string, ctx?: Record<string, unknown>): void;
  };
}

export interface RecordPromiseOutcomeInput {
  readonly kind: PromiseKind;
  readonly agreedDate: string;
  readonly dueDate: string;
  readonly actualOutcome: PromiseOutcome;
  readonly notes?: string | null;
}

export class CreditRatingServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CreditRatingServiceError';
    this.code = code;
  }
}

export interface CreditRatingService {
  computeRating(tenantId: string, customerId: string): Promise<CreditRating>;
  recomputeAll(tenantId: string): Promise<readonly CreditRating[]>;
  recordPromiseOutcome(
    tenantId: string,
    customerId: string,
    outcome: RecordPromiseOutcomeInput,
  ): Promise<PromiseOutcomeRecord>;
  getHistory(
    tenantId: string,
    customerId: string,
    months: number,
  ): Promise<readonly CreditRatingHistoryEntry[]>;
  getWeights(tenantId: string): Promise<GradingWeights>;
  setWeights(tenantId: string, weights: GradingWeights): Promise<GradingWeights>;
  optInSharing(params: {
    tenantId: string;
    customerId: string;
    shareWithOrg: string;
    purpose: string;
    durationDays: number;
  }): Promise<CreditSharingOptIn>;
  revokeSharing(
    tenantId: string,
    customerId: string,
    optInId: string,
  ): Promise<void>;
  listSharing(
    tenantId: string,
    customerId: string,
  ): Promise<readonly CreditSharingOptIn[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function computeDelayDays(dueDate: string, actualDate: string): number {
  const due = Date.parse(dueDate);
  const act = Date.parse(actualDate);
  if (Number.isNaN(due) || Number.isNaN(act)) return 0;
  return Math.max(0, Math.round((act - due) / (24 * 60 * 60 * 1000)));
}

export function createCreditRatingService(
  deps: CreditRatingServiceDeps,
): CreditRatingService {
  const { repo } = deps;
  const clock = deps.clock ?? nowIso;
  const log = deps.logger;

  async function resolveWeights(tenantId: string): Promise<GradingWeights> {
    const stored = await repo.loadWeights(tenantId);
    return stored ?? DEFAULT_GRADING_WEIGHTS;
  }

  async function computeRating(
    tenantId: string,
    customerId: string,
  ): Promise<CreditRating> {
    const asOf = clock();
    const inputs = await repo.loadInputs(tenantId, customerId, asOf);
    if (!inputs) {
      throw new CreditRatingServiceError(
        'CUSTOMER_NOT_FOUND',
        `Customer ${customerId} not found in tenant ${tenantId}.`,
      );
    }
    const weights = await resolveWeights(tenantId);
    const rating = scoreTenantCredit(inputs, weights);
    try {
      await repo.saveSnapshot(rating);
    } catch (err) {
      log?.error('credit-rating: saveSnapshot failed', {
        tenantId,
        customerId,
        error: (err as Error).message,
      });
      // Snapshot persistence is best-effort — we still return the rating.
    }
    return rating;
  }

  async function recomputeAll(
    tenantId: string,
  ): Promise<readonly CreditRating[]> {
    const customerIds = await repo.listCustomerIds(tenantId);
    const ratings: CreditRating[] = [];
    for (const customerId of customerIds) {
      try {
        const r = await computeRating(tenantId, customerId);
        ratings.push(r);
      } catch (err) {
        log?.error('credit-rating: recomputeAll skipped customer', {
          tenantId,
          customerId,
          error: (err as Error).message,
        });
      }
    }
    return ratings;
  }

  async function recordPromiseOutcome(
    tenantId: string,
    customerId: string,
    input: RecordPromiseOutcomeInput,
  ): Promise<PromiseOutcomeRecord> {
    if (!tenantId || !customerId) {
      throw new CreditRatingServiceError(
        'INVALID_INPUT',
        'tenantId and customerId are required.',
      );
    }
    const record: PromiseOutcomeRecord = {
      id: uuid(),
      tenantId,
      customerId,
      kind: input.kind,
      agreedDate: input.agreedDate,
      dueDate: input.dueDate,
      actualOutcome: input.actualOutcome,
      delayDays:
        input.actualOutcome === 'late'
          ? computeDelayDays(input.dueDate, clock())
          : 0,
      notes: input.notes ?? null,
      recordedAt: clock(),
    };
    await repo.savePromiseOutcome(record);
    log?.info('credit-rating: promise outcome recorded', {
      tenantId,
      customerId,
      kind: input.kind,
      outcome: input.actualOutcome,
    });
    return record;
  }

  async function getHistory(
    tenantId: string,
    customerId: string,
    months: number,
  ): Promise<readonly CreditRatingHistoryEntry[]> {
    const safeMonths = Math.max(1, Math.min(60, Math.floor(months)));
    return repo.listHistory(tenantId, customerId, safeMonths);
  }

  async function getWeights(tenantId: string): Promise<GradingWeights> {
    return resolveWeights(tenantId);
  }

  async function setWeights(
    tenantId: string,
    weights: GradingWeights,
  ): Promise<GradingWeights> {
    validateWeights(weights);
    await repo.saveWeights(tenantId, weights);
    return weights;
  }

  async function optInSharing(params: {
    tenantId: string;
    customerId: string;
    shareWithOrg: string;
    purpose: string;
    durationDays: number;
  }): Promise<CreditSharingOptIn> {
    const days = Math.max(1, Math.min(365, Math.floor(params.durationDays)));
    const grantedAt = clock();
    const expiresAt = new Date(
      Date.parse(grantedAt) + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const record: CreditSharingOptIn = {
      id: uuid(),
      tenantId: params.tenantId,
      customerId: params.customerId,
      shareWithOrg: params.shareWithOrg,
      grantedAt,
      expiresAt,
      revokedAt: null,
      purpose: params.purpose,
    };
    await repo.saveSharingOptIn(record);
    return record;
  }

  async function revokeSharing(
    tenantId: string,
    customerId: string,
    optInId: string,
  ): Promise<void> {
    await repo.revokeSharingOptIn(tenantId, customerId, optInId);
  }

  async function listSharing(
    tenantId: string,
    customerId: string,
  ): Promise<readonly CreditSharingOptIn[]> {
    return repo.listSharingOptIns(tenantId, customerId);
  }

  return {
    computeRating,
    recomputeAll,
    recordPromiseOutcome,
    getHistory,
    getWeights,
    setWeights,
    optInSharing,
    revokeSharing,
    listSharing,
  };
}

function validateWeights(w: GradingWeights): void {
  const vals = [
    w.payment_history,
    w.promise_keeping,
    w.rent_to_income,
    w.tenancy_length,
    w.dispute_history,
  ];
  for (const v of vals) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new CreditRatingServiceError(
        'INVALID_WEIGHTS',
        'All weights must be finite non-negative numbers.',
      );
    }
  }
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new CreditRatingServiceError(
      'INVALID_WEIGHTS',
      'Weights must sum to > 0.',
    );
  }
}
