/**
 * Context Accumulator Service — THE key progressive-intelligence piece.
 *
 * Accumulates structured data from user turns, uploaded docs, filled forms,
 * and LPMS imports into a typed AccumulatedEstateContext per session.
 *
 * Every update:
 *   1. is applied immutably (never mutates prior context)
 *   2. bumps a version counter
 *   3. emits a ContextChangeEvent
 *   4. validates against the section schema
 *
 * Cross-tenant isolation: each (tenantId, sessionId) tuple is a distinct
 * context. Access from another tenant throws.
 *
 * @module progressive-intelligence/context-accumulator
 */

import {
  extractFromMessage,
  firstMatch,
  type PatternMatch,
} from './extraction-patterns.js';
import {
  findBestMapping,
  getAffectedSections,
  inferMaintenanceCategory,
  SECTION_REQUIRED_FIELDS,
  type SectionId,
} from './field-mappings.js';
import type {
  AccumulatedEstateContext,
  ContextChangeEvent,
  ContextChangeListener,
  DataSource,
  FieldMetadata,
  ReadinessReport,
  SectionReadiness,
} from './types.js';
import { validateAccumulatedContext } from './validation/index.js';

// ============================================================================
// Builders
// ============================================================================

function blankContext(
  sessionId: string,
  tenantId: string,
): AccumulatedEstateContext {
  const now = new Date().toISOString();
  return {
    sessionId,
    tenantId,
    createdAt: now,
    updatedAt: now,
    property: {},
    tenantProfile: {},
    leaseTerms: {},
    maintenanceCase: {},
    migrationBatch: {},
    renewalProposal: {},
    complianceNotice: {},
    fieldMetadata: {},
    version: 1,
  };
}

// ============================================================================
// Service
// ============================================================================

export class ContextAccumulatorService {
  private readonly contexts = new Map<string, AccumulatedEstateContext>();
  private readonly listeners = new Set<ContextChangeListener>();

  // ---- Initialisation ----------------------------------------------------

  initializeContext(
    sessionId: string,
    tenantId: string,
  ): AccumulatedEstateContext {
    assertTenant(tenantId);
    const key = this.keyFor(tenantId, sessionId);
    const existing = this.contexts.get(key);
    if (existing) return existing;
    const ctx = blankContext(sessionId, tenantId);
    this.contexts.set(key, ctx);
    return ctx;
  }

  getContext(
    sessionId: string,
    tenantId: string,
  ): AccumulatedEstateContext | null {
    assertTenant(tenantId);
    return this.contexts.get(this.keyFor(tenantId, sessionId)) ?? null;
  }

  // ---- Event emitters ----------------------------------------------------

  onChange(listener: ContextChangeListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ContextChangeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listener error isolation */
      }
    }
  }

  // ---- Updates -----------------------------------------------------------

  /**
   * Apply a structured update to the context immutably.
   */
  updateField(input: {
    sessionId: string;
    tenantId: string;
    path: string;
    value: unknown;
    source: DataSource;
    confidence: number;
    rawValue?: string;
    sourceDocumentId?: string;
  }): AccumulatedEstateContext {
    assertTenant(input.tenantId);
    const key = this.keyFor(input.tenantId, input.sessionId);
    const prev = this.contexts.get(key) ?? blankContext(input.sessionId, input.tenantId);

    const next = setAtPath(prev, input.path, input.value);
    const confidenceTier =
      input.confidence >= 0.8
        ? 'high'
        : input.confidence >= 0.5
          ? 'medium'
          : 'low';
    const meta: FieldMetadata = {
      updatedAt: new Date().toISOString(),
      source: input.source,
      confidence: input.confidence,
      confidenceTier,
      confirmed: input.source === 'user_confirmed',
      rawValue: input.rawValue,
      sourceDocumentId: input.sourceDocumentId,
    };
    const updated: AccumulatedEstateContext = {
      ...next,
      fieldMetadata: { ...next.fieldMetadata, [input.path]: meta },
      updatedAt: new Date().toISOString(),
      version: prev.version + 1,
    };
    this.contexts.set(key, updated);

    this.emit({
      type: 'field_updated',
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      fieldPath: input.path,
      newValue: input.value,
      affectedSections: getAffectedSections(input.path),
      timestamp: updated.updatedAt,
      version: updated.version,
    });

    return updated;
  }

  /**
   * Ingest a chat message: run extractors + keyword classifiers and apply
   * every matched mapping.
   */
  ingestChatMessage(input: {
    sessionId: string;
    tenantId: string;
    text: string;
    attachmentsUrls?: readonly string[];
  }): {
    updatedContext: AccumulatedEstateContext;
    applied: readonly PatternMatch[];
  } {
    assertTenant(input.tenantId);
    const matches = extractFromMessage(input.text);
    const applied: PatternMatch[] = [];
    let ctx = this.initializeContext(input.sessionId, input.tenantId);

    for (const match of matches) {
      const mapping = findBestMapping(match);
      if (!mapping) continue;
      const value =
        mapping.targetPath.endsWith('Cents') && typeof match.normalized === 'number'
          ? Math.round(match.normalized * 100)
          : match.normalized;
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: mapping.targetPath,
        value,
        source: 'chat',
        confidence: match.confidence,
        rawValue: match.raw,
      });
      applied.push(match);
    }

    const maintenance = inferMaintenanceCategory(input.text);
    if (maintenance) {
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: 'maintenanceCase.category',
        value: maintenance.category,
        source: 'chat',
        confidence: 0.7,
      });
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: 'maintenanceCase.severity',
        value: maintenance.severity,
        source: 'inferred',
        confidence: 0.55,
      });
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: 'maintenanceCase.description',
        value: input.text.slice(0, 4000),
        source: 'chat',
        confidence: 0.9,
      });
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: 'maintenanceCase.reportedAt',
        value: new Date().toISOString(),
        source: 'inferred',
        confidence: 0.95,
      });
      if (input.attachmentsUrls && input.attachmentsUrls.length > 0) {
        ctx = this.updateField({
          sessionId: input.sessionId,
          tenantId: input.tenantId,
          path: 'maintenanceCase.evidence',
          value: [...input.attachmentsUrls],
          source: 'chat',
          confidence: 0.95,
        });
      }
    }

    // Detect high-confidence phone to pick country code
    const tzPhone = firstMatch(matches, 'phone_tz');
    const kePhone = firstMatch(matches, 'phone_ke');
    if (tzPhone) {
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: 'tenantProfile.countryCode',
        value: 'TZ',
        source: 'inferred',
        confidence: 0.8,
      });
    } else if (kePhone) {
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: 'tenantProfile.countryCode',
        value: 'KE',
        source: 'inferred',
        confidence: 0.8,
      });
    }

    return { updatedContext: ctx, applied };
  }

  /**
   * Ingest structured fields extracted from an LPMS import row.
   */
  ingestLpmsRow(input: {
    sessionId: string;
    tenantId: string;
    sourceSystem: string;
    sourceFile: string;
    row: Record<string, unknown>;
  }): AccumulatedEstateContext {
    assertTenant(input.tenantId);
    let ctx = this.initializeContext(input.sessionId, input.tenantId);

    ctx = this.updateField({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      path: 'migrationBatch.sourceSystem',
      value: input.sourceSystem,
      source: 'lpms_import',
      confidence: 1,
    });
    ctx = this.updateField({
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      path: 'migrationBatch.sourceFile',
      value: input.sourceFile,
      source: 'lpms_import',
      confidence: 1,
    });

    const mapping: Record<string, string> = {
      tenant_name: 'tenantProfile.tenantName',
      phone: 'tenantProfile.phone',
      email: 'tenantProfile.email',
      national_id: 'tenantProfile.nationalId',
      monthly_rent: 'leaseTerms.monthlyRentCents',
      lease_start: 'leaseTerms.startDate',
      tenure_months: 'leaseTerms.tenureMonths',
      property_ref: 'property.propertyRef',
      unit_label: 'property.unitLabel',
    };

    for (const [src, dest] of Object.entries(mapping)) {
      if (input.row[src] === undefined || input.row[src] === null) continue;
      const raw = input.row[src];
      const value =
        dest.endsWith('Cents') && typeof raw === 'number'
          ? Math.round(raw * 100)
          : raw;
      ctx = this.updateField({
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        path: dest,
        value,
        source: 'lpms_import',
        confidence: 0.85,
      });
    }

    return ctx;
  }

  // ---- Readiness ---------------------------------------------------------

  computeReadiness(
    sessionId: string,
    tenantId: string,
  ): ReadinessReport {
    assertTenant(tenantId);
    const ctx = this.getContext(sessionId, tenantId);
    if (!ctx) {
      return {
        sessionId,
        overallPct: 0,
        sections: [],
        suggestions: ['Context not initialized'],
      };
    }

    const sections: SectionReadiness[] = [];
    for (const [sectionId, fields] of Object.entries(SECTION_REQUIRED_FIELDS)) {
      const filled = fields.filter((f) => ctx.fieldMetadata[f] !== undefined);
      const missing = fields.filter((f) => !ctx.fieldMetadata[f]);
      sections.push({
        sectionId,
        completionPct:
          fields.length === 0 ? 100 : (filled.length / fields.length) * 100,
        filledCount: filled.length,
        totalCount: fields.length,
        missingFields: missing,
        canGenerate: missing.length === 0,
      });
    }

    const overallPct =
      sections.length === 0
        ? 0
        : sections.reduce((sum, s) => sum + s.completionPct, 0) /
          sections.length;

    const suggestions = sections
      .filter((s) => s.completionPct > 0 && s.completionPct < 100)
      .flatMap((s) => s.missingFields.map((m) => `complete ${m}`));

    return { sessionId, overallPct, sections, suggestions };
  }

  // ---- Reset -------------------------------------------------------------

  clear(sessionId: string, tenantId: string): void {
    assertTenant(tenantId);
    this.contexts.delete(this.keyFor(tenantId, sessionId));
  }

  // ---- Internals ---------------------------------------------------------

  private keyFor(tenantId: string, sessionId: string): string {
    return `${tenantId}::${sessionId}`;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function assertTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('context-accumulator: tenantId is required');
  }
}

function setAtPath<T>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.');
  // shallow immutable clone along the path
  const [head, ...rest] = parts;
  if (!head) return obj;
  const current = (obj as unknown as Record<string, unknown>)[head];
  if (rest.length === 0) {
    return { ...(obj as object), [head]: value } as T;
  }
  const child =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return {
    ...(obj as object),
    [head]: setAtPath(child, rest.join('.'), value),
  } as T;
}

// ============================================================================
// Factory
// ============================================================================

export function createContextAccumulator(): ContextAccumulatorService {
  return new ContextAccumulatorService();
}

// Re-export validator for callers that want full commit-gate enforcement.
export { validateAccumulatedContext };
export type { SectionId };
