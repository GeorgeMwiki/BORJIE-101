/**
 * Field capture pipeline — submit + validate.
 *
 * `submitFieldCapture({ surveyorId, parcelId, captures })` validates
 * each capture (kind-specific rules), signs with the C2PA stub, and
 * appends to the in-memory store. Offline-first: callers can persist
 * the queue locally on mobile and bulk-sync via the field-capture-service.
 *
 * The AI inference hook is pluggable — by default we attach a tiny rule-
 * based stub that suggests a "buildingGuess" based on the EXIF heading.
 * Production wires this to a real vision model in the service tier.
 */

import { randomUUID } from 'node:crypto';
import type {
  CaptureId,
  CaptureKind,
  ExifGps,
  FieldCapture,
  ParcelId,
  TenantId,
  UserId,
} from '../types.js';
import {
  hashCapturePayload,
  signCapture,
  type C2paSignaturePayload,
} from './c2pa-on-device.js';
import { parseExifGps } from './exif.js';

export interface FieldCaptureInput {
  readonly kind: CaptureKind;
  readonly bytes?: ArrayBuffer | Uint8Array;
  readonly parcelId?: ParcelId;
  readonly capturedAt?: string;
  readonly capturedLocation?: ExifGps;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly storageUri?: string;
}

export interface SubmitFieldCaptureArgs {
  readonly surveyorUserId: UserId;
  readonly tenantId: TenantId;
  readonly parcelId?: ParcelId;
  readonly captures: ReadonlyArray<FieldCaptureInput>;
}

export interface AiInferenceFn {
  (capture: FieldCapture, bytes?: ArrayBuffer | Uint8Array):
    | Promise<Readonly<Record<string, unknown>>>
    | Readonly<Record<string, unknown>>;
}

export interface CaptureStore {
  readonly add: (capture: FieldCapture) => void;
  readonly listForSurveyor: (
    surveyorUserId: UserId,
    statusFilter?: FieldCapture['status'],
  ) => ReadonlyArray<FieldCapture>;
  readonly getById: (captureId: CaptureId) => FieldCapture | null;
  readonly updateStatus: (
    captureId: CaptureId,
    status: FieldCapture['status'],
  ) => FieldCapture | null;
}

export function createInMemoryCaptureStore(): CaptureStore {
  const map = new Map<CaptureId, FieldCapture>();
  return Object.freeze({
    add(capture: FieldCapture): void {
      map.set(capture.captureId, capture);
    },
    listForSurveyor(
      surveyorUserId: UserId,
      statusFilter?: FieldCapture['status'],
    ): ReadonlyArray<FieldCapture> {
      const out: FieldCapture[] = [];
      for (const c of map.values()) {
        if (c.surveyorUserId !== surveyorUserId) continue;
        if (statusFilter && c.status !== statusFilter) continue;
        out.push(c);
      }
      return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    getById(captureId: CaptureId): FieldCapture | null {
      return map.get(captureId) ?? null;
    },
    updateStatus(captureId: CaptureId, status: FieldCapture['status']): FieldCapture | null {
      const existing = map.get(captureId);
      if (!existing) return null;
      const updated: FieldCapture = Object.freeze({ ...existing, status });
      map.set(captureId, updated);
      return updated;
    },
  });
}

export interface CapturePipelineDeps {
  readonly store: CaptureStore;
  readonly aiInference?: AiInferenceFn;
  readonly clock?: () => Date;
}

/**
 * Returns a closure that submits and processes captures end-to-end.
 */
export function createCapturePipeline(deps: CapturePipelineDeps) {
  const clock = deps.clock ?? (() => new Date());

  async function submitFieldCapture(
    args: SubmitFieldCaptureArgs,
  ): Promise<ReadonlyArray<FieldCapture>> {
    const out: FieldCapture[] = [];
    for (const input of args.captures) {
      // Determine capture location: explicit > EXIF > none.
      let location: ExifGps | undefined = input.capturedLocation;
      if (!location && input.bytes && input.kind === 'photo') {
        const ab =
          input.bytes instanceof ArrayBuffer
            ? input.bytes
            : (input.bytes.buffer as ArrayBuffer).slice(
                input.bytes.byteOffset,
                input.bytes.byteOffset + input.bytes.byteLength,
              );
        const exif = parseExifGps(ab);
        if (exif) location = exif;
      }

      // Reject photos with no GPS at all (caller can still submit with
      // explicit `capturedLocation`).
      if (input.kind === 'photo' && !location) {
        const rejected: FieldCapture = Object.freeze({
          captureId: randomUUID(),
          tenantId: args.tenantId,
          surveyorUserId: args.surveyorUserId,
          ...(args.parcelId !== undefined ? { parcelId: args.parcelId } : {}),
          ...(input.parcelId !== undefined ? { parcelId: input.parcelId } : {}),
          kind: input.kind,
          capturedAt: input.capturedAt ?? clock().toISOString(),
          status: 'rejected',
          metadata: Object.freeze({
            rejectionReason: 'photo capture missing GPS (EXIF + explicit both absent)',
            ...(input.metadata ?? {}),
          }),
          createdAt: clock().toISOString(),
        });
        deps.store.add(rejected);
        out.push(rejected);
        continue;
      }

      const captureId = randomUUID();
      const payloadBytes = input.bytes ?? new TextEncoder().encode(captureId);
      const payloadHashHex = hashCapturePayload(payloadBytes);
      const c2paPayload: C2paSignaturePayload = {
        captureId,
        kind: input.kind,
        capturedAt: input.capturedAt ?? clock().toISOString(),
        surveyorUserId: args.surveyorUserId,
        tenantId: args.tenantId,
        payloadHashHex,
        ...(location ? { location: { lat: location.lat, lng: location.lng } } : {}),
      };
      const signature = signCapture(c2paPayload);

      const base: FieldCapture = Object.freeze({
        captureId,
        tenantId: args.tenantId,
        surveyorUserId: args.surveyorUserId,
        ...(input.parcelId !== undefined ? { parcelId: input.parcelId } : args.parcelId !== undefined ? { parcelId: args.parcelId } : {}),
        kind: input.kind,
        capturedAt: c2paPayload.capturedAt,
        ...(location
          ? {
              capturedLocation: {
                type: 'Point' as const,
                coordinates: [location.lng, location.lat] as readonly [number, number],
              },
            }
          : {}),
        ...(input.storageUri !== undefined ? { storageUri: input.storageUri } : {}),
        c2paSignature: signature,
        ...(location ? { exifMetadata: { ...location } } : {}),
        status: 'queued',
        metadata: Object.freeze({ ...(input.metadata ?? {}) }),
        createdAt: clock().toISOString(),
      });

      // AI inference (best-effort).
      let inferences: Readonly<Record<string, unknown>> | undefined;
      if (deps.aiInference) {
        try {
          inferences = await deps.aiInference(base, input.bytes);
        } catch {
          inferences = { error: 'inference_failed' };
        }
      }

      const finalCapture: FieldCapture = Object.freeze({
        ...base,
        ...(inferences ? { aiInferences: inferences } : {}),
        status: 'processed',
      });
      deps.store.add(finalCapture);
      out.push(finalCapture);
    }
    return out;
  }

  return Object.freeze({ submitFieldCapture });
}

// ============================================================================
// Default AI inference stub — deterministic, no network
// ============================================================================

export function defaultAiInference(): AiInferenceFn {
  return (capture: FieldCapture, _bytes?: ArrayBuffer | Uint8Array) => {
    if (capture.kind !== 'photo') return Object.freeze({});
    const inferred: Record<string, unknown> = {
      detectedObjects: ['building'],
      buildingGuess: 1,
    };
    if (capture.capturedLocation) {
      inferred.note = 'inferred-from-stub';
    }
    return Object.freeze(inferred);
  };
}
