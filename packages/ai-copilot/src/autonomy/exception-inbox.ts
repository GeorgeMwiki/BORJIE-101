/**
 * Exception inbox — surfaces the 1-in-20 items that need the head's eyes.
 *
 * Mr. Mwikila runs the department on the policy rails; anything the rails
 * refuse is logged here with priority and a recommended resolution so the
 * head can triage in minutes rather than scrub the raw event firehose.
 *
 * Priority model:
 *   P1 — needs a decision today (large amount, imminent deadline, or high
 *        strategic weight)
 *   P2 — this week
 *   P3 — this month
 */

import type { AutonomyDomain } from './types.js';

export type ExceptionPriority = 'P1' | 'P2' | 'P3';
export type ExceptionStatus = 'open' | 'resolved' | 'dismissed';

export interface EvidenceRef {
  readonly kind: string;
  readonly id: string;
}

export interface Exception {
  readonly id: string;
  readonly tenantId: string;
  readonly domain: AutonomyDomain | 'strategic' | 'anomaly';
  readonly kind: string;
  readonly priority: ExceptionPriority;
  readonly title: string;
  readonly description: string;
  readonly amountMinorUnits: number | null;
  readonly dueAt: string | null;
  readonly strategicWeight: number;
  readonly recommendedAction: string | null;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly status: ExceptionStatus;
  readonly resolutionDecision: string | null;
  readonly resolutionNote: string | null;
  readonly resolvedByUserId: string | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface AddExceptionInput {
  readonly tenantId: string;
  readonly domain: Exception['domain'];
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly amountMinorUnits?: number;
  readonly dueAt?: Date | string | null;
  readonly strategicWeight?: number;
  readonly recommendedAction?: string;
  readonly evidenceRefs?: readonly EvidenceRef[];
}

export interface ListOpenFilters {
  readonly domain?: Exception['domain'];
  readonly priority?: ExceptionPriority;
  readonly limit?: number;
}

export interface ResolveInput {
  readonly resolution: string;
  readonly note?: string;
  readonly resolvedByUserId: string;
}

export interface ExceptionRepository {
  insert(exception: Exception): Promise<Exception>;
  listOpen(tenantId: string, filters: ListOpenFilters): Promise<readonly Exception[]>;
  findById(tenantId: string, id: string): Promise<Exception | null>;
  update(tenantId: string, id: string, patch: Partial<Exception>): Promise<Exception>;
}

export interface ExceptionInboxDeps {
  readonly repository: ExceptionRepository;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
}

export class ExceptionInbox {
  private readonly deps: ExceptionInboxDeps;

  constructor(deps: ExceptionInboxDeps) {
    this.deps = deps;
  }

  async addException(input: AddExceptionInput): Promise<Exception> {
    const now = this.deps.clock?.() ?? new Date();
    const dueAt = normaliseDue(input.dueAt ?? null);
    const priority = scorePriority({
      amountMinorUnits: input.amountMinorUnits ?? 0,
      dueAt,
      strategicWeight: input.strategicWeight ?? 0,
      now,
    });
    const exception: Exception = {
      id: this.deps.idFactory?.() ?? `exc_${now.getTime()}_${randomSuffix()}`,
      tenantId: input.tenantId,
      domain: input.domain,
      kind: input.kind,
      priority,
      title: input.title,
      description: input.description,
      amountMinorUnits: input.amountMinorUnits ?? null,
      dueAt: dueAt?.toISOString() ?? null,
      strategicWeight: input.strategicWeight ?? 0,
      recommendedAction: input.recommendedAction ?? null,
      evidenceRefs: input.evidenceRefs ?? [],
      status: 'open',
      resolutionDecision: null,
      resolutionNote: null,
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: now.toISOString(),
    };
    return this.deps.repository.insert(exception);
  }

  async listOpen(
    tenantId: string,
    filters: ListOpenFilters = {},
  ): Promise<readonly Exception[]> {
    return this.deps.repository.listOpen(tenantId, filters);
  }

  async acknowledge(tenantId: string, id: string, userId: string): Promise<Exception> {
    const existing = await this.deps.repository.findById(tenantId, id);
    if (!existing) throw new Error(`Exception ${id} not found for tenant ${tenantId}`);
    if (existing.status !== 'open') return existing;
    return this.deps.repository.update(tenantId, id, {
      resolvedByUserId: userId,
    });
  }

  async resolve(
    tenantId: string,
    id: string,
    input: ResolveInput,
  ): Promise<Exception> {
    const existing = await this.deps.repository.findById(tenantId, id);
    if (!existing) throw new Error(`Exception ${id} not found for tenant ${tenantId}`);
    const now = this.deps.clock?.() ?? new Date();
    return this.deps.repository.update(tenantId, id, {
      status: 'resolved',
      resolutionDecision: input.resolution,
      resolutionNote: input.note ?? null,
      resolvedByUserId: input.resolvedByUserId,
      resolvedAt: now.toISOString(),
    });
  }
}

interface PriorityInputs {
  readonly amountMinorUnits: number;
  readonly dueAt: Date | null;
  readonly strategicWeight: number;
  readonly now: Date;
}

/**
 * Priority score combines:
 *   - amount-at-stake (large cash > small cash)
 *   - time-sensitivity (soon > later)
 *   - strategic-weight (head-flagged topics)
 *
 * Thresholds are deliberate round numbers, not tuned to a specific
 * customer. Heads can re-tune via the delegation matrix.
 */
export function scorePriority(inputs: PriorityInputs): ExceptionPriority {
  const amountScore = scoreAmount(inputs.amountMinorUnits);
  const timeScore = scoreTime(inputs.dueAt, inputs.now);
  const strategicScore = clamp01(inputs.strategicWeight / 10);
  const composite = Math.max(amountScore, timeScore, strategicScore);
  if (composite >= 0.7) return 'P1';
  if (composite >= 0.35) return 'P2';
  return 'P3';
}

function scoreAmount(amountMinorUnits: number): number {
  if (amountMinorUnits <= 0) return 0;
  // 100k minor units = low, 1M = mid, 10M+ = high.
  if (amountMinorUnits >= 10_000_000) return 1;
  if (amountMinorUnits >= 1_000_000) return 0.7;
  if (amountMinorUnits >= 100_000) return 0.4;
  return 0.1;
}

function scoreTime(dueAt: Date | null, now: Date): number {
  if (!dueAt) return 0;
  const ms = dueAt.getTime() - now.getTime();
  const hours = ms / 3_600_000;
  if (hours <= 24) return 1;
  if (hours <= 72) return 0.7;
  if (hours <= 168) return 0.4;
  return 0.1;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normaliseDue(value: Date | string | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** In-memory repo for tests + degraded mode. */
export class InMemoryExceptionRepository implements ExceptionRepository {
  private readonly store = new Map<string, Exception>();

  async insert(exception: Exception): Promise<Exception> {
    this.store.set(key(exception.tenantId, exception.id), exception);
    return exception;
  }

  async listOpen(
    tenantId: string,
    filters: ListOpenFilters,
  ): Promise<readonly Exception[]> {
    const all = Array.from(this.store.values())
      .filter((e) => e.tenantId === tenantId && e.status === 'open')
      .filter((e) => (filters.domain ? e.domain === filters.domain : true))
      .filter((e) => (filters.priority ? e.priority === filters.priority : true));
    all.sort((a, b) => {
      const pri = priorityRank(a.priority) - priorityRank(b.priority);
      if (pri !== 0) return pri;
      return b.createdAt.localeCompare(a.createdAt);
    });
    return filters.limit ? all.slice(0, filters.limit) : all;
  }

  async findById(tenantId: string, id: string): Promise<Exception | null> {
    return this.store.get(key(tenantId, id)) ?? null;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Exception>,
  ): Promise<Exception> {
    const existing = this.store.get(key(tenantId, id));
    if (!existing) throw new Error(`Exception ${id} not found`);
    const next: Exception = { ...existing, ...patch };
    this.store.set(key(tenantId, id), next);
    return next;
  }
}

function key(tenantId: string, id: string): string {
  return `${tenantId}::${id}`;
}

function priorityRank(p: ExceptionPriority): number {
  return p === 'P1' ? 0 : p === 'P2' ? 1 : 2;
}
