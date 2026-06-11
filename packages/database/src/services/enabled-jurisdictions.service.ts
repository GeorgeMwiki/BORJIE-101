/**
 * Enabled-jurisdictions service — the data-access layer for the generative
 * launch-market gate (migration 0337). Signup reads `listEnabledCountries()`
 * instead of a hardcoded enum; the governed `mwikila.jurisdiction.promote` flow
 * calls `enableCountry()`; admin compliance-doc ingestion calls `recordUpload()`
 * and feeds the shared corpus elsewhere. Jurisdiction is data, never code.
 */

import { eq, isNull, and, desc } from 'drizzle-orm';

import type { DatabaseClient } from '../client.js';
import {
  enabledCountries,
  regionOverlays,
  complianceDocUploads,
  type EnabledCountryRow,
  type RegionOverlayRow,
} from '../schemas/enabled-jurisdictions.schema.js';

export interface EnableCountryInput {
  readonly code: string;
  readonly name: string;
  readonly currencyCode?: string;
  readonly enabledByAdminId?: string;
  readonly learnedFromCorpus?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface EnabledJurisdictionsService {
  /** Country codes currently selectable at signup (active = not disabled). */
  listEnabledCountries(): Promise<readonly string[]>;
  /** Full active rows (for admin surfaces). */
  listEnabledRows(): Promise<readonly EnabledCountryRow[]>;
  /** TRUE iff `code` is enabled + not disabled. The data-driven TZ-gate. */
  isCountryEnabled(code: string): Promise<boolean>;
  /** Promote a learned country into the launch market (idempotent upsert). */
  enableCountry(input: EnableCountryInput): Promise<EnabledCountryRow>;
  /** Soft-disable a country (keeps history). */
  disableCountry(code: string): Promise<void>;
  /** Per-country overlay (VAT/timezone/locale/phone) when the plugin lacks it. */
  getRegionOverlay(code: string): Promise<RegionOverlayRow | null>;
  /** Record an admin compliance-doc upload (provenance for the learn loop). */
  recordUpload(input: {
    id: string;
    countryCode: string;
    docType?: string;
    uploadedByAdminId?: string;
    filePath?: string;
    /** Chunks written into the shared corpus for this upload. */
    corpusChunkCount?: number;
    /** Lifecycle of the source→corpus extraction. Defaults to 'pending'. */
    extractionStatus?: 'pending' | 'ingested' | 'failed';
  }): Promise<void>;
}

export function createEnabledJurisdictionsService(
  db: DatabaseClient,
): EnabledJurisdictionsService {
  return {
    async listEnabledCountries() {
      const rows = await db
        .select({ code: enabledCountries.code })
        .from(enabledCountries)
        .where(isNull(enabledCountries.disabledAt));
      return rows.map((r) => r.code.toUpperCase());
    },

    async listEnabledRows() {
      return db
        .select()
        .from(enabledCountries)
        .where(isNull(enabledCountries.disabledAt))
        .orderBy(desc(enabledCountries.enabledAt));
    },

    async isCountryEnabled(code) {
      const upper = code.toUpperCase();
      const rows = await db
        .select({ code: enabledCountries.code })
        .from(enabledCountries)
        .where(
          and(eq(enabledCountries.code, upper), isNull(enabledCountries.disabledAt)),
        )
        .limit(1);
      return rows.length > 0;
    },

    async enableCountry(input) {
      const upper = input.code.toUpperCase();
      const values = {
        code: upper,
        name: input.name,
        currencyCode: input.currencyCode ?? null,
        enabledByAdminId: input.enabledByAdminId ?? null,
        learnedFromCorpus: input.learnedFromCorpus ?? false,
        metadata: input.metadata ?? {},
        disabledAt: null,
      };
      const [row] = await db
        .insert(enabledCountries)
        .values(values)
        .onConflictDoUpdate({
          target: enabledCountries.code,
          set: {
            name: values.name,
            currencyCode: values.currencyCode,
            enabledByAdminId: values.enabledByAdminId,
            learnedFromCorpus: values.learnedFromCorpus,
            metadata: values.metadata,
            disabledAt: null,
          },
        })
        .returning();
      return row as EnabledCountryRow;
    },

    async disableCountry(code) {
      await db
        .update(enabledCountries)
        .set({ disabledAt: new Date() })
        .where(eq(enabledCountries.code, code.toUpperCase()));
    },

    async getRegionOverlay(code) {
      const rows = await db
        .select()
        .from(regionOverlays)
        .where(eq(regionOverlays.countryCode, code.toUpperCase()))
        .limit(1);
      return rows[0] ?? null;
    },

    async recordUpload(input) {
      await db.insert(complianceDocUploads).values({
        id: input.id,
        countryCode: input.countryCode.toUpperCase(),
        docType: input.docType ?? null,
        uploadedByAdminId: input.uploadedByAdminId ?? null,
        filePath: input.filePath ?? null,
        corpusChunkCount: input.corpusChunkCount ?? 0,
        extractionStatus: input.extractionStatus ?? 'pending',
      });
    },
  };
}
