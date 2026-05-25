/**
 * DSAR service — submit + process pipeline.
 *
 * Pure functions:
 *   - `submitDSAR` validates input + computes SLA → returns a
 *     `DSARRequest`.
 *   - `processAccessRequest` walks collectors → returns `DSARResponse`.
 *   - `processPortabilityRequest` does the same but tagged for a
 *     downstream serializer (`json | csv`).
 *   - `processErasureRequest` delegates to the erasure cascade and
 *     returns an `ErasureReport` (executed by the cascade runner).
 *
 * NO DB calls inside this module — collectors are injected.
 */

import type {
  DSARChannel,
  DSARKind,
  DSARRequest,
  DSARResponse,
  ErasureCascadeSpec,
  ErasureReport,
  Jurisdiction,
} from '../types.js';
import { DSARSubjectNotFoundError } from '../types.js';
import { type CascadeRunner } from '../erasure-cascade/runner.js';
import { type DSARCollector, runCollectors } from './collector.js';
import { computeDSARDeadline } from './sla-table.js';

export interface DSARServiceDeps {
  readonly collectors: ReadonlyArray<DSARCollector>;
  readonly cascadeRunner?: CascadeRunner | undefined;
  readonly now?: (() => Date) | undefined;
  readonly idFactory?: (() => string) | undefined;
}

export interface DSARService {
  submit(params: {
    readonly subjectId: string;
    readonly kind: DSARKind;
    readonly jurisdiction: Jurisdiction;
    readonly channel: DSARChannel;
  }): DSARRequest;
  processAccess(params: { readonly request: DSARRequest }): Promise<DSARResponse>;
  processPortability(params: {
    readonly request: DSARRequest;
    readonly format: 'json' | 'csv';
  }): Promise<DSARResponse>;
  processRectification(params: {
    readonly request: DSARRequest;
    readonly corrections: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  }): Promise<DSARResponse>;
  processErasure(params: {
    readonly request: DSARRequest;
    readonly cascade: ErasureCascadeSpec;
  }): Promise<ErasureReport>;
}

/**
 * Build a DSAR service. The `idFactory` and `now` indirections are
 * for deterministic tests; production wiring uses defaults.
 */
export function createDSARService(deps: DSARServiceDeps): DSARService {
  const now = deps.now ?? (() => new Date());
  const idFactory = deps.idFactory ?? defaultIdFactory;

  function summarise(records: ReadonlyArray<{
    readonly columns: Readonly<Record<string, unknown>>;
    readonly piiFields: ReadonlyArray<string>;
  }>) {
    const piiSet = new Set<string>();
    for (const r of records) {
      for (const f of r.piiFields) piiSet.add(f);
    }
    return {
      tablesScanned: deps.collectors.length,
      recordsFound: records.length,
      piiFieldsFound: piiSet.size,
    };
  }

  return {
    submit({ subjectId, kind, jurisdiction, channel }): DSARRequest {
      const receivedAt = now();
      const slaDueAt = computeDSARDeadline(receivedAt, jurisdiction, kind);
      return {
        id: idFactory(),
        subjectId,
        kind,
        jurisdiction,
        channel,
        receivedAt: receivedAt.toISOString(),
        slaDueAt: slaDueAt.toISOString(),
        state: 'received',
      };
    },

    async processAccess({ request }): Promise<DSARResponse> {
      const records = await runCollectors(deps.collectors, request.subjectId);
      return {
        requestId: request.id,
        subjectId: request.subjectId,
        kind: request.kind,
        producedAt: now().toISOString(),
        format: 'json',
        records,
        summary: summarise(records),
      };
    },

    async processPortability({ request, format }): Promise<DSARResponse> {
      const records = await runCollectors(deps.collectors, request.subjectId);
      return {
        requestId: request.id,
        subjectId: request.subjectId,
        kind: request.kind,
        producedAt: now().toISOString(),
        format,
        records,
        summary: summarise(records),
      };
    },

    async processRectification({ request, corrections }): Promise<DSARResponse> {
      const records = await runCollectors(deps.collectors, request.subjectId);
      if (records.length === 0) {
        throw new DSARSubjectNotFoundError(
          `subject ${request.subjectId} not found in any collector`,
        );
      }
      // We do NOT execute the correction here (the platform's write
      // path is responsibility-of); we return the records flagged with
      // the corrections so the integration layer can apply them
      // atomically.
      const flagged = records.map((r) => {
        const patch = corrections.get(`${r.table}:${r.primaryKey}`);
        if (!patch) return r;
        return {
          ...r,
          columns: { ...r.columns, ...patch },
        };
      });
      return {
        requestId: request.id,
        subjectId: request.subjectId,
        kind: request.kind,
        producedAt: now().toISOString(),
        format: 'json',
        records: flagged,
        summary: summarise(flagged),
      };
    },

    async processErasure({ request, cascade }): Promise<ErasureReport> {
      if (!deps.cascadeRunner) {
        throw new Error(
          'processErasure called but no cascadeRunner provided to createDSARService',
        );
      }
      const records = await runCollectors(deps.collectors, request.subjectId);
      return deps.cascadeRunner.run({
        cascadeId: idFactory(),
        subjectId: request.subjectId,
        cascade,
        records,
        now,
      });
    },
  };
}

let counter = 0;

function defaultIdFactory(): string {
  counter += 1;
  return `dsar_${Date.now().toString(36)}_${counter.toString(36)}`;
}
