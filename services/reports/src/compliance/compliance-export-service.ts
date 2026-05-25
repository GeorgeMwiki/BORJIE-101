/**
 * Compliance Export Service
 *
 * NEW-20: unified facade for scheduling, generating, and serving download
 * URLs for regulator-facing exports.
 *
 *   - schedule(): persists a manifest row (`scheduled` status)
 *   - generate(): runs the appropriate formatter, writes to storage, moves
 *                 status to `ready`
 *   - download(): returns a signed URL + records `downloadedAt`
 */

import type { TenantId, ISOTimestamp, UserId } from '@borjie/domain-models';
import { randomHex } from '../common/id-generator.js';

import {
  formatTzTraCsv,
  type TzTraRentEntry,
  type TzTraExportContext,
} from './tz-tra-formatter.js';
import {
  formatKeDpaJsonLines,
  type KeDpaAuditEntry,
  type KeDpaExportContext,
} from './ke-dpa-formatter.js';
import {
  formatKeKraCsv,
  type KeKraRentEntry,
  type KeKraExportContext,
} from './ke-kra-formatter.js';
import {
  formatTzLandActJson,
  type TzLandActLeaseEntry,
  type TzLandActExportContext,
} from './tz-land-act-formatter.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComplianceExportType =
  | 'tz_tra'
  | 'ke_dpa'
  | 'ke_kra'
  | 'tz_land_act';

export type ComplianceExportStatus =
  | 'scheduled'
  | 'generating'
  | 'ready'
  | 'downloaded'
  | 'failed'
  | 'archived';

export type ComplianceExportFormat = 'csv' | 'json' | 'xml' | 'pdf';

export interface ComplianceExportManifest {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly exportType: ComplianceExportType;
  readonly format: ComplianceExportFormat;
  readonly status: ComplianceExportStatus;
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly scheduledAt: ISOTimestamp;
  readonly generatedAt: ISOTimestamp | null;
  readonly downloadedAt: ISOTimestamp | null;
  readonly storageKey: string | null;
  readonly fileSizeBytes: number | null;
  readonly fileChecksum: string | null;
  readonly regulatorContext: Record<string, unknown>;
  readonly errorMessage: string | null;
  readonly requestedBy: UserId | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export interface ComplianceExportRepository {
  create(m: ComplianceExportManifest): Promise<ComplianceExportManifest>;
  update(m: ComplianceExportManifest): Promise<ComplianceExportManifest>;
  findById(
    id: string,
    tenantId: TenantId,
  ): Promise<ComplianceExportManifest | null>;
}

export interface ObjectStorage {
  put(params: {
    readonly storageKey: string;
    readonly body: string;
    readonly contentType: string;
  }): Promise<{ readonly sizeBytes: number; readonly checksum: string }>;
  getSignedUrl(params: {
    readonly storageKey: string;
    readonly expiresInSeconds: number;
  }): Promise<string>;
}

export interface ComplianceDataProvider {
  tzTraEntries(
    tenantId: TenantId,
    periodStart: ISOTimestamp,
    periodEnd: ISOTimestamp,
  ): Promise<TzTraRentEntry[]>;
  keDpaEntries(
    tenantId: TenantId,
    periodStart: ISOTimestamp,
    periodEnd: ISOTimestamp,
  ): Promise<KeDpaAuditEntry[]>;
  keKraEntries(
    tenantId: TenantId,
    periodStart: ISOTimestamp,
    periodEnd: ISOTimestamp,
  ): Promise<KeKraRentEntry[]>;
  tzLandActEntries(
    tenantId: TenantId,
    periodStart: ISOTimestamp,
    periodEnd: ISOTimestamp,
  ): Promise<TzLandActLeaseEntry[]>;
}

export interface ComplianceExportServiceDeps {
  readonly repo: ComplianceExportRepository;
  readonly storage: ObjectStorage;
  readonly data: ComplianceDataProvider;
}

export interface ScheduleExportInput {
  readonly tenantId: TenantId;
  readonly exportType: ComplianceExportType;
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly regulatorContext: Record<string, unknown>;
  readonly requestedBy: UserId;
}

function contentTypeFor(fmt: ComplianceExportFormat): string {
  switch (fmt) {
    case 'csv':
      return 'text/csv; charset=utf-8';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'xml':
      return 'application/xml; charset=utf-8';
    case 'pdf':
      return 'application/pdf';
  }
}

function formatFor(type: ComplianceExportType): ComplianceExportFormat {
  switch (type) {
    case 'tz_tra':
      return 'csv';
    case 'ke_kra':
      return 'csv';
    case 'ke_dpa':
      return 'json';
    case 'tz_land_act':
      return 'json';
  }
}

export class ComplianceExportService {
  constructor(private readonly deps: ComplianceExportServiceDeps) {}

  async schedule(
    input: ScheduleExportInput,
  ): Promise<ComplianceExportManifest> {
    const now = new Date().toISOString() as ISOTimestamp;
    const manifest: ComplianceExportManifest = {
      id: `cexp_${Date.now()}_${randomHex(4)}`,
      tenantId: input.tenantId,
      exportType: input.exportType,
      format: formatFor(input.exportType),
      status: 'scheduled',
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      scheduledAt: now,
      generatedAt: null,
      downloadedAt: null,
      storageKey: null,
      fileSizeBytes: null,
      fileChecksum: null,
      regulatorContext: input.regulatorContext,
      errorMessage: null,
      requestedBy: input.requestedBy,
      createdAt: now,
      updatedAt: now,
    };
    return this.deps.repo.create(manifest);
  }

  async generate(
    exportId: string,
    tenantId: TenantId,
  ): Promise<ComplianceExportManifest> {
    const existing = await this.deps.repo.findById(exportId, tenantId);
    if (!existing) {
      throw new Error(`Compliance export ${exportId} not found`);
    }

    const nowGenerating = new Date().toISOString() as ISOTimestamp;
    await this.deps.repo.update({
      ...existing,
      status: 'generating',
      updatedAt: nowGenerating,
    });

    let body: string;
    try {
      body = await this.renderBody(existing);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString() as ISOTimestamp;
      return this.deps.repo.update({
        ...existing,
        status: 'failed',
        errorMessage: msg,
        updatedAt: now,
      });
    }

    const storageKey = `compliance/${tenantId}/${existing.exportType}/${existing.id}.${existing.format}`;
    const { sizeBytes, checksum } = await this.deps.storage.put({
      storageKey,
      body,
      contentType: contentTypeFor(existing.format),
    });

    const nowReady = new Date().toISOString() as ISOTimestamp;
    return this.deps.repo.update({
      ...existing,
      status: 'ready',
      storageKey,
      fileSizeBytes: sizeBytes,
      fileChecksum: checksum,
      generatedAt: nowReady,
      errorMessage: null,
      updatedAt: nowReady,
    });
  }

  async download(
    exportId: string,
    tenantId: TenantId,
  ): Promise<{
    readonly url: string;
    readonly manifest: ComplianceExportManifest;
  }> {
    const manifest = await this.deps.repo.findById(exportId, tenantId);
    if (!manifest) {
      throw new Error(`Compliance export ${exportId} not found`);
    }
    if (manifest.status !== 'ready' && manifest.status !== 'downloaded') {
      throw new Error(
        `Export ${exportId} is not ready (status=${manifest.status})`,
      );
    }
    if (!manifest.storageKey) {
      throw new Error(`Export ${exportId} has no storage key`);
    }
    const url = await this.deps.storage.getSignedUrl({
      storageKey: manifest.storageKey,
      expiresInSeconds: 900,
    });
    const now = new Date().toISOString() as ISOTimestamp;
    const updated = await this.deps.repo.update({
      ...manifest,
      status: 'downloaded',
      downloadedAt: now,
      updatedAt: now,
    });
    return { url, manifest: updated };
  }

  private async renderBody(
    manifest: ComplianceExportManifest,
  ): Promise<string> {
    const { tenantId, periodStart, periodEnd, regulatorContext } = manifest;
    switch (manifest.exportType) {
      case 'tz_tra': {
        const entries = await this.deps.data.tzTraEntries(
          tenantId,
          periodStart,
          periodEnd,
        );
        const ctx: TzTraExportContext = {
          periodStart,
          periodEnd,
          tenantTin: String(regulatorContext.tenantTin ?? ''),
          currency: 'TZS',
        };
        return formatTzTraCsv(entries, ctx);
      }
      case 'ke_dpa': {
        const entries = await this.deps.data.keDpaEntries(
          tenantId,
          periodStart,
          periodEnd,
        );
        const ctx: KeDpaExportContext = {
          controllerName: String(regulatorContext.controllerName ?? ''),
          controllerRegistrationNumber: String(
            regulatorContext.controllerRegistrationNumber ?? '',
          ),
          dpoContactEmail: String(regulatorContext.dpoContactEmail ?? ''),
          periodStart,
          periodEnd,
        };
        return formatKeDpaJsonLines(entries, ctx);
      }
      case 'ke_kra': {
        const entries = await this.deps.data.keKraEntries(
          tenantId,
          periodStart,
          periodEnd,
        );
        const ctx: KeKraExportContext = {
          periodStart,
          periodEnd,
          filerPin: String(regulatorContext.filerPin ?? ''),
          currency: 'KES',
        };
        return formatKeKraCsv(entries, ctx);
      }
      case 'tz_land_act': {
        const entries = await this.deps.data.tzLandActEntries(
          tenantId,
          periodStart,
          periodEnd,
        );
        const ctx: TzLandActExportContext = {
          filingEntity: String(regulatorContext.filingEntity ?? ''),
          filingEntityTin: String(regulatorContext.filingEntityTin ?? ''),
          periodStart,
          periodEnd,
        };
        return formatTzLandActJson(entries, ctx);
      }
    }
  }
}

export function createComplianceExportService(
  deps: ComplianceExportServiceDeps,
): ComplianceExportService {
  return new ComplianceExportService(deps);
}
