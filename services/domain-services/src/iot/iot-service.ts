// @ts-nocheck — pre-existing hard-fork drift; out of scope for issue #61 (5-file slice).
/**
 * IoT Service (Wave 8 — S3 gap closure)
 *
 * Owns the post-lease usage-monitoring domain:
 *   • sensor registration (`iot_sensors`, unique per tenant + external_id)
 *   • append-only observation ingestion (`iot_observations`)
 *   • inline anomaly detection on each observation (`iot_anomalies`)
 *   • tenant-scoped reads/acks/resolutions
 *
 * Silence detection is deliberately handled by a separate periodic job
 * (`detectSilenceAnomalies` in ./silence-detector.ts) so ingestion stays
 * low-latency and silence scans remain idempotent across restarts.
 *
 * Design invariants:
 *   1. Every query is tenant-scoped. No method accepts a sensor/anomaly id
 *      without pairing it with a tenantId.
 *   2. Observations are append-only; updates to a sensor's last_seen_at
 *      happen in a second statement but never rewrite observation rows.
 *   3. `detectAnomalies(sensor, observation)` is a PURE function — it never
 *      touches the database. The service wraps it and persists results.
 *   4. IDs come from `randomHex(16)` (32 hex chars); IDs are text columns
 *      everywhere so no UUID conversion is needed.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §S3 (Post-lease IoT usage).
 */

import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import {
  iotSensors,
  iotObservations,
  iotAnomalies,
} from '@borjie/database';
import { randomHex } from '../common/id-generator.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type IotSensorKind =
  | 'water_meter'
  | 'electricity_meter'
  | 'gas_meter'
  | 'temperature'
  | 'humidity'
  | 'occupancy'
  | 'door_lock'
  | 'smoke'
  | 'co'
  | 'vibration'
  | 'satellite_image'
  | 'drone_scan'
  | 'custom';

export type IotObservationQuality = 'good' | 'suspect' | 'bad';

export type IotAnomalyType =
  | 'threshold_breach'
  | 'silence'
  | 'tamper'
  | 'pattern'
  | 'calibration_drift'
  | 'value_spike'
  | 'cross_sensor_mismatch';

export type IotAnomalySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IotSensor {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: IotSensorKind;
  readonly externalId: string;
  readonly vendor: string;
  readonly unitId: string | null;
  readonly propertyId: string | null;
  readonly geoNodeId: string | null;
  readonly label: string | null;
  readonly unitOfMeasure: string | null;
  readonly samplingIntervalSeconds: number | null;
  readonly expectedMin: number | null;
  readonly expectedMax: number | null;
  readonly silenceThresholdSeconds: number | null;
  readonly active: boolean;
  readonly metadata: Record<string, unknown>;
  readonly registeredAt: Date;
  readonly lastSeenAt: Date | null;
}

export interface IotObservation {
  readonly id: string;
  readonly tenantId: string;
  readonly sensorId: string;
  readonly observedAt: Date;
  readonly numericValue: number | null;
  readonly booleanValue: boolean | null;
  readonly stringValue: string | null;
  readonly jsonbValue: Record<string, unknown> | null;
  readonly quality: IotObservationQuality;
  readonly rawPayload: Record<string, unknown> | null;
  readonly ingestedAt: Date;
}

export interface IotAnomaly {
  readonly id: string;
  readonly tenantId: string;
  readonly sensorId: string;
  readonly detectedAt: Date;
  readonly anomalyType: IotAnomalyType;
  readonly severity: IotAnomalySeverity;
  readonly observationId: string | null;
  readonly observedValue: number | null;
  readonly expectedRangeMin: number | null;
  readonly expectedRangeMax: number | null;
  readonly message: string;
  readonly acknowledgedAt: Date | null;
  readonly acknowledgedBy: string | null;
  readonly resolvedAt: Date | null;
  readonly resolvedBy: string | null;
  readonly resolutionNotes: string | null;
  readonly metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RegisterSensorInput {
  readonly kind: IotSensorKind;
  readonly externalId: string;
  readonly vendor: string;
  readonly unitId?: string | null;
  readonly propertyId?: string | null;
  readonly geoNodeId?: string | null;
  readonly label?: string | null;
  readonly unitOfMeasure?: string | null;
  readonly samplingIntervalSeconds?: number | null;
  readonly expectedMin?: number | null;
  readonly expectedMax?: number | null;
  readonly silenceThresholdSeconds?: number | null;
  readonly active?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface IngestObservationInput {
  readonly sensorId: string;
  readonly observedAt: Date;
  readonly numericValue?: number | null;
  readonly booleanValue?: boolean | null;
  readonly stringValue?: string | null;
  readonly jsonbValue?: Record<string, unknown> | null;
  readonly quality?: IotObservationQuality;
  readonly rawPayload?: Record<string, unknown> | null;
}

export interface IngestResult {
  readonly observationId: string;
  readonly anomaliesCreated: number;
  readonly anomalies: readonly IotAnomaly[];
}

export interface ListSensorFilters {
  readonly kind?: IotSensorKind;
  readonly unitId?: string;
  readonly propertyId?: string;
  readonly activeOnly?: boolean;
}

export interface ListObservationsOptions {
  readonly since?: Date;
  readonly limit?: number;
}

export interface ListAnomaliesFilters {
  readonly unresolved?: boolean;
  readonly severity?: IotAnomalySeverity;
  readonly sensorId?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class IotServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'SENSOR_NOT_FOUND'
      | 'ANOMALY_NOT_FOUND'
      | 'TENANT_MISMATCH'
      | 'VALIDATION'
      | 'ALREADY_RESOLVED'
  ) {
    super(message);
    this.name = 'IotServiceError';
  }
}

// ---------------------------------------------------------------------------
// Pure anomaly detection
// ---------------------------------------------------------------------------

/**
 * Pure function. Evaluates a single observation against its sensor's
 * configured bounds and returns the anomaly *descriptors* (WITHOUT id or
 * persistence fields) that should be recorded. Silence detection is
 * handled elsewhere — see ./silence-detector.ts.
 *
 * Detection rules:
 *   1. value_spike  — numericValue > expectedMax * 2 (severity: critical)
 *   2. threshold_breach — numericValue < expectedMin OR > expectedMax
 *      (severity: high)
 *
 * Rule 1 takes precedence: a spike always dwarfs a plain bounds breach,
 * and we don't want duplicate anomalies for the same observation.
 */
export interface AnomalyDescriptor {
  readonly anomalyType: IotAnomalyType;
  readonly severity: IotAnomalySeverity;
  readonly observedValue: number | null;
  readonly expectedRangeMin: number | null;
  readonly expectedRangeMax: number | null;
  readonly message: string;
}

export function detectAnomalies(
  sensor: Pick<IotSensor, 'expectedMin' | 'expectedMax' | 'kind' | 'externalId'>,
  observation: Pick<IotObservation, 'numericValue'>
): readonly AnomalyDescriptor[] {
  const value = observation.numericValue;
  if (value === null || value === undefined || Number.isNaN(value)) {
    return [];
  }

  const min = sensor.expectedMin;
  const max = sensor.expectedMax;

  // Rule 1: value spike (> 2x expected max)
  if (max !== null && max !== undefined && value > max * 2) {
    return [
      {
        anomalyType: 'value_spike',
        severity: 'critical',
        observedValue: value,
        expectedRangeMin: min ?? null,
        expectedRangeMax: max,
        message: `Value spike on ${sensor.kind} ${sensor.externalId}: observed ${value}, more than 2x expected max ${max}`,
      },
    ];
  }

  // Rule 2: threshold breach (below min or above max, but not a spike)
  const belowMin =
    min !== null && min !== undefined && value < min;
  const aboveMax =
    max !== null && max !== undefined && value > max;
  if (belowMin || aboveMax) {
    return [
      {
        anomalyType: 'threshold_breach',
        severity: 'high',
        observedValue: value,
        expectedRangeMin: min ?? null,
        expectedRangeMax: max ?? null,
        message: `Threshold breach on ${sensor.kind} ${sensor.externalId}: observed ${value}, expected range [${min ?? '-inf'}, ${max ?? '+inf'}]`,
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface IotServiceDeps {
  readonly db: unknown;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export interface IotService {
  registerSensor(
    tenantId: string,
    input: RegisterSensorInput,
    userId: string
  ): Promise<IotSensor>;

  ingestObservation(
    tenantId: string,
    input: IngestObservationInput,
    userId: string
  ): Promise<IngestResult>;

  listSensors(
    tenantId: string,
    filters?: ListSensorFilters
  ): Promise<readonly IotSensor[]>;

  getSensor(tenantId: string, sensorId: string): Promise<IotSensor | null>;

  listObservations(
    tenantId: string,
    sensorId: string,
    options?: ListObservationsOptions
  ): Promise<readonly IotObservation[]>;

  listAnomalies(
    tenantId: string,
    filters?: ListAnomaliesFilters
  ): Promise<readonly IotAnomaly[]>;

  acknowledgeAnomaly(
    tenantId: string,
    anomalyId: string,
    userId: string
  ): Promise<IotAnomaly>;

  resolveAnomaly(
    tenantId: string,
    anomalyId: string,
    notes: string,
    userId: string
  ): Promise<IotAnomaly>;
}

export function createIotService(deps: IotServiceDeps): IotService {
  const db = deps.db as any;
  const now = deps.now ?? (() => new Date());
  const genId = deps.idGenerator ?? (() => randomHex(16));

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  type SensorRow = typeof iotSensors.$inferSelect;
  type ObservationRow = typeof iotObservations.$inferSelect;
  type AnomalyRow = typeof iotAnomalies.$inferSelect;

  function rowToSensor(row: SensorRow): IotSensor {
    return {
      id: row.id,
      tenantId: row.tenantId,
      kind: row.kind,
      externalId: row.externalId,
      vendor: row.vendor,
      unitId: row.unitId ?? null,
      propertyId: row.propertyId ?? null,
      geoNodeId: row.geoNodeId ?? null,
      label: row.label ?? null,
      unitOfMeasure: row.unitOfMeasure ?? null,
      samplingIntervalSeconds: row.samplingIntervalSeconds ?? null,
      expectedMin:
        row.expectedMin === null || row.expectedMin === undefined
          ? null
          : Number(row.expectedMin),
      expectedMax:
        row.expectedMax === null || row.expectedMax === undefined
          ? null
          : Number(row.expectedMax),
      silenceThresholdSeconds: row.silenceThresholdSeconds ?? null,
      active: Boolean(row.active),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      registeredAt: toDate(row.registeredAt) ?? new Date(0),
      lastSeenAt: toDate(row.lastSeenAt),
    };
  }

  function rowToObservation(row: ObservationRow): IotObservation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      sensorId: row.sensorId,
      observedAt: toDate(row.observedAt) ?? new Date(0),
      numericValue:
        row.numericValue === null || row.numericValue === undefined
          ? null
          : Number(row.numericValue),
      booleanValue:
        row.booleanValue === null || row.booleanValue === undefined
          ? null
          : Boolean(row.booleanValue),
      stringValue: row.stringValue ?? null,
      jsonbValue: (row.jsonbValue ?? null) as Record<string, unknown> | null,
      quality: (row.quality ?? 'good') as IotObservationQuality,
      rawPayload: (row.rawPayload ?? null) as Record<string, unknown> | null,
      ingestedAt: toDate(row.ingestedAt) ?? new Date(0),
    };
  }

  function rowToAnomaly(row: AnomalyRow): IotAnomaly {
    return {
      id: row.id,
      tenantId: row.tenantId,
      sensorId: row.sensorId,
      detectedAt: toDate(row.detectedAt) ?? new Date(0),
      anomalyType: row.anomalyType as IotAnomalyType,
      severity: (row.severity ?? 'medium') as IotAnomalySeverity,
      observationId: row.observationId ?? null,
      observedValue:
        row.observedValue === null || row.observedValue === undefined
          ? null
          : Number(row.observedValue),
      expectedRangeMin:
        row.expectedRangeMin === null || row.expectedRangeMin === undefined
          ? null
          : Number(row.expectedRangeMin),
      expectedRangeMax:
        row.expectedRangeMax === null || row.expectedRangeMax === undefined
          ? null
          : Number(row.expectedRangeMax),
      message: row.message,
      acknowledgedAt: toDate(row.acknowledgedAt),
      acknowledgedBy: row.acknowledgedBy ?? null,
      resolvedAt: toDate(row.resolvedAt),
      resolvedBy: row.resolvedBy ?? null,
      resolutionNotes: row.resolutionNotes ?? null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  }

  // -------------------------------------------------------------------------
  // Queries (tenant-scoped)
  // -------------------------------------------------------------------------

  async function findSensorByExternalId(
    tenantId: string,
    externalId: string
  ): Promise<IotSensor | null> {
    const rows = await db
      .select()
      .from(iotSensors)
      .where(
        and(
          eq(iotSensors.tenantId, tenantId),
          eq(iotSensors.externalId, externalId)
        )
      )
      .limit(1);
    return rows[0] ? rowToSensor(rows[0]) : null;
  }

  async function findSensorById(
    tenantId: string,
    sensorId: string
  ): Promise<IotSensor | null> {
    const rows = await db
      .select()
      .from(iotSensors)
      .where(
        and(eq(iotSensors.tenantId, tenantId), eq(iotSensors.id, sensorId))
      )
      .limit(1);
    return rows[0] ? rowToSensor(rows[0]) : null;
  }

  async function findAnomalyById(
    tenantId: string,
    anomalyId: string
  ): Promise<IotAnomaly | null> {
    const rows = await db
      .select()
      .from(iotAnomalies)
      .where(
        and(
          eq(iotAnomalies.tenantId, tenantId),
          eq(iotAnomalies.id, anomalyId)
        )
      )
      .limit(1);
    return rows[0] ? rowToAnomaly(rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // Service methods
  // -------------------------------------------------------------------------

  return {
    async registerSensor(tenantId, input, _userId) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      if (!input.externalId) {
        throw new IotServiceError('externalId required', 'VALIDATION');
      }
      if (!input.vendor) {
        throw new IotServiceError('vendor required', 'VALIDATION');
      }

      const existing = await findSensorByExternalId(tenantId, input.externalId);

      // Upsert semantics — the UNIQUE(tenant_id, external_id) index means
      // a re-registration must update the existing row rather than blow up.
      if (existing) {
        const patch: Record<string, unknown> = {
          kind: input.kind,
          vendor: input.vendor,
          unitId: input.unitId ?? existing.unitId,
          propertyId: input.propertyId ?? existing.propertyId,
          geoNodeId: input.geoNodeId ?? existing.geoNodeId,
          label: input.label ?? existing.label,
          unitOfMeasure: input.unitOfMeasure ?? existing.unitOfMeasure,
          samplingIntervalSeconds:
            input.samplingIntervalSeconds ?? existing.samplingIntervalSeconds,
          expectedMin:
            input.expectedMin !== undefined
              ? input.expectedMin
              : existing.expectedMin,
          expectedMax:
            input.expectedMax !== undefined
              ? input.expectedMax
              : existing.expectedMax,
          silenceThresholdSeconds:
            input.silenceThresholdSeconds ?? existing.silenceThresholdSeconds,
          active: input.active ?? existing.active,
          metadata: input.metadata ?? existing.metadata,
        };
        await db
          .update(iotSensors)
          .set(patch)
          .where(
            and(
              eq(iotSensors.tenantId, tenantId),
              eq(iotSensors.id, existing.id)
            )
          );
        const updated = await findSensorById(tenantId, existing.id);
        if (!updated) {
          throw new IotServiceError(
            'sensor disappeared after update',
            'SENSOR_NOT_FOUND'
          );
        }
        return updated;
      }

      const id = genId();
      const registeredAt = now();
      const row = {
        id,
        tenantId,
        kind: input.kind,
        externalId: input.externalId,
        vendor: input.vendor,
        unitId: input.unitId ?? null,
        propertyId: input.propertyId ?? null,
        geoNodeId: input.geoNodeId ?? null,
        label: input.label ?? null,
        unitOfMeasure: input.unitOfMeasure ?? null,
        samplingIntervalSeconds: input.samplingIntervalSeconds ?? null,
        expectedMin: input.expectedMin ?? null,
        expectedMax: input.expectedMax ?? null,
        silenceThresholdSeconds: input.silenceThresholdSeconds ?? null,
        active: input.active ?? true,
        metadata: input.metadata ?? {},
        registeredAt,
        lastSeenAt: null,
      };
      await db.insert(iotSensors).values(row);
      const created = await findSensorById(tenantId, id);
      if (!created) {
        throw new IotServiceError(
          'sensor disappeared after insert',
          'SENSOR_NOT_FOUND'
        );
      }
      return created;
    },

    async ingestObservation(tenantId, input, _userId) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      if (!input.sensorId) {
        throw new IotServiceError('sensorId required', 'VALIDATION');
      }
      if (!(input.observedAt instanceof Date) || Number.isNaN(input.observedAt.getTime())) {
        throw new IotServiceError('observedAt must be a valid Date', 'VALIDATION');
      }

      const sensor = await findSensorById(tenantId, input.sensorId);
      if (!sensor) {
        throw new IotServiceError(
          `sensor ${input.sensorId} not found for tenant ${tenantId}`,
          'SENSOR_NOT_FOUND'
        );
      }

      const observationId = genId();
      const ingestedAt = now();
      const observationRow = {
        id: observationId,
        tenantId,
        sensorId: sensor.id,
        observedAt: input.observedAt,
        numericValue:
          input.numericValue === undefined ? null : input.numericValue,
        booleanValue:
          input.booleanValue === undefined ? null : input.booleanValue,
        stringValue:
          input.stringValue === undefined ? null : input.stringValue,
        jsonbValue: input.jsonbValue ?? null,
        quality: input.quality ?? 'good',
        rawPayload: input.rawPayload ?? null,
        ingestedAt,
      };
      await db.insert(iotObservations).values(observationRow);

      // Advance last_seen_at on the sensor — monotonically non-decreasing.
      const newLastSeen =
        sensor.lastSeenAt && sensor.lastSeenAt > input.observedAt
          ? sensor.lastSeenAt
          : input.observedAt;
      await db
        .update(iotSensors)
        .set({ lastSeenAt: newLastSeen })
        .where(
          and(eq(iotSensors.tenantId, tenantId), eq(iotSensors.id, sensor.id))
        );

      // Anomaly detection — pure function; service persists the descriptors.
      const observationForDetector: Pick<IotObservation, 'numericValue'> = {
        numericValue:
          input.numericValue === undefined ? null : input.numericValue,
      };
      const descriptors = detectAnomalies(sensor, observationForDetector);
      const anomalies: IotAnomaly[] = [];
      for (const d of descriptors) {
        const anomalyId = genId();
        const detectedAt = now();
        const anomalyRow = {
          id: anomalyId,
          tenantId,
          sensorId: sensor.id,
          detectedAt,
          anomalyType: d.anomalyType,
          severity: d.severity,
          observationId,
          observedValue: d.observedValue,
          expectedRangeMin: d.expectedRangeMin,
          expectedRangeMax: d.expectedRangeMax,
          message: d.message,
          acknowledgedAt: null,
          acknowledgedBy: null,
          resolvedAt: null,
          resolvedBy: null,
          resolutionNotes: null,
          metadata: {},
        };
        await db.insert(iotAnomalies).values(anomalyRow);
        anomalies.push(rowToAnomaly(anomalyRow));
      }

      return {
        observationId,
        anomaliesCreated: anomalies.length,
        anomalies,
      };
    },

    async listSensors(tenantId, filters) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      const rows = await db
        .select()
        .from(iotSensors)
        .where(eq(iotSensors.tenantId, tenantId));
      const mapped = rows.map(rowToSensor);
      return mapped.filter((s) => {
        if (filters?.kind && s.kind !== filters.kind) return false;
        if (filters?.unitId && s.unitId !== filters.unitId) return false;
        if (filters?.propertyId && s.propertyId !== filters.propertyId)
          return false;
        if (filters?.activeOnly && !s.active) return false;
        return true;
      });
    },

    async getSensor(tenantId, sensorId) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      return findSensorById(tenantId, sensorId);
    },

    async listObservations(tenantId, sensorId, options) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      if (!sensorId) {
        throw new IotServiceError('sensorId required', 'VALIDATION');
      }
      // Enforce tenant isolation: the sensor must belong to this tenant
      // before we will return any of its observations.
      const sensor = await findSensorById(tenantId, sensorId);
      if (!sensor) {
        return [];
      }
      const limit = options?.limit ?? 100;
      const rows = await db
        .select()
        .from(iotObservations)
        .where(
          and(
            eq(iotObservations.tenantId, tenantId),
            eq(iotObservations.sensorId, sensorId)
          )
        )
        .orderBy(desc(iotObservations.observedAt))
        .limit(limit);
      const mapped = rows.map(rowToObservation);
      if (options?.since) {
        const since = options.since;
        return mapped.filter((o) => o.observedAt >= since);
      }
      return mapped;
    },

    async listAnomalies(tenantId, filters) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      const rows = await db
        .select()
        .from(iotAnomalies)
        .where(eq(iotAnomalies.tenantId, tenantId))
        .orderBy(desc(iotAnomalies.detectedAt));
      const mapped = rows.map(rowToAnomaly);
      return mapped.filter((a) => {
        if (filters?.unresolved && a.resolvedAt !== null) return false;
        if (filters?.severity && a.severity !== filters.severity) return false;
        if (filters?.sensorId && a.sensorId !== filters.sensorId) return false;
        return true;
      }).slice(0, filters?.limit ?? mapped.length);
    },

    async acknowledgeAnomaly(tenantId, anomalyId, userId) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      if (!anomalyId) {
        throw new IotServiceError('anomalyId required', 'VALIDATION');
      }
      const existing = await findAnomalyById(tenantId, anomalyId);
      if (!existing) {
        throw new IotServiceError(
          `anomaly ${anomalyId} not found for tenant ${tenantId}`,
          'ANOMALY_NOT_FOUND'
        );
      }
      const ackAt = now();
      await db
        .update(iotAnomalies)
        .set({ acknowledgedAt: ackAt, acknowledgedBy: userId })
        .where(
          and(
            eq(iotAnomalies.tenantId, tenantId),
            eq(iotAnomalies.id, anomalyId)
          )
        );
      const reloaded = await findAnomalyById(tenantId, anomalyId);
      if (!reloaded) {
        throw new IotServiceError(
          'anomaly disappeared after ack',
          'ANOMALY_NOT_FOUND'
        );
      }
      return reloaded;
    },

    async resolveAnomaly(tenantId, anomalyId, notes, userId) {
      if (!tenantId) {
        throw new IotServiceError('tenantId required', 'VALIDATION');
      }
      if (!anomalyId) {
        throw new IotServiceError('anomalyId required', 'VALIDATION');
      }
      if (!notes || notes.trim().length === 0) {
        throw new IotServiceError(
          'resolutionNotes required',
          'VALIDATION'
        );
      }
      const existing = await findAnomalyById(tenantId, anomalyId);
      if (!existing) {
        throw new IotServiceError(
          `anomaly ${anomalyId} not found for tenant ${tenantId}`,
          'ANOMALY_NOT_FOUND'
        );
      }
      if (existing.resolvedAt !== null) {
        throw new IotServiceError(
          `anomaly ${anomalyId} is already resolved`,
          'ALREADY_RESOLVED'
        );
      }
      const resolvedAt = now();
      const patch: Record<string, unknown> = {
        resolvedAt,
        resolvedBy: userId,
        resolutionNotes: notes,
      };
      // Acking implicitly happens on resolution if it wasn't already acked.
      if (!existing.acknowledgedAt) {
        patch.acknowledgedAt = resolvedAt;
        patch.acknowledgedBy = userId;
      }
      await db
        .update(iotAnomalies)
        .set(patch)
        .where(
          and(
            eq(iotAnomalies.tenantId, tenantId),
            eq(iotAnomalies.id, anomalyId)
          )
        );
      const reloaded = await findAnomalyById(tenantId, anomalyId);
      if (!reloaded) {
        throw new IotServiceError(
          'anomaly disappeared after resolve',
          'ANOMALY_NOT_FOUND'
        );
      }
      return reloaded;
    },
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
