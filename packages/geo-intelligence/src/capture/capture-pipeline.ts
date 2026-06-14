/**
 * Field capture pipeline — submit + validate.
 *
 * `submitFieldCapture({ surveyorId, parcelId, captures })` validates
 * each capture (kind-specific rules), signs with the C2PA stub, and
 * appends to the in-memory store. Offline-first: callers can persist
 * the queue locally on mobile and bulk-sync via the field-capture-service.
 *
 * The AI inference hook is pluggable. The DEFAULT provider is flagged
 * `live: false`: it is NOT a real model and never fabricates results.
 * When no real provider is configured, captures are marked
 * `pending_analysis` (honest "awaiting analysis" state) instead of being
 * stamped `processed` with mock values (KI-012 / no-mock-in-production).
 * Production wires a real vision model in the service tier, which takes
 * the unchanged `processed` path.
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
  /**
   * `false` ⇒ no REAL inference provider is configured (deterministic
   * stub / demo). Mirrors the `live` flag on the imagery providers in
   * `imagery/providers.ts`. When `false`, the pipeline marks captures
   * `pending_analysis` instead of `processed`, and does NOT attach
   * fabricated inference values — honest empty state, never mock-as-real
   * (KI-012). Omit (or set `true`) for a real provider to keep the
   * `processed` path unchanged.
   */
  readonly live?: boolean;
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

      // AI inference. A provider explicitly flagged `live === false` is
      // the deterministic stub / unconfigured case: we must NOT run it
      // and present fabricated values as a completed analysis (KI-012).
      // Instead the capture is marked `pending_analysis` and carries an
      // honest marker so the consuming UI renders "awaiting analysis"
      // rather than mock-as-real. Fail-CLOSED: any inference error also
      // degrades to `pending_analysis` (never a fabricated `processed`).
      const providerLive = !deps.aiInference || deps.aiInference.live !== false;

      let inferences: Readonly<Record<string, unknown>> | undefined;
      let inferenceFailed = false;
      if (deps.aiInference && providerLive) {
        try {
          inferences = await deps.aiInference(base, input.bytes);
        } catch {
          inferenceFailed = true;
          inferences = { error: 'inference_failed' };
        }
      }

      const analyzed = providerLive && !inferenceFailed;
      const finalCapture: FieldCapture = analyzed
        ? Object.freeze({
            ...base,
            ...(inferences ? { aiInferences: inferences } : {}),
            status: 'processed',
          })
        : Object.freeze({
            ...base,
            // Honest, non-fabricated marker. Carries WHY it is pending so
            // the UI can explain it; no detected objects / guesses.
            aiInferences: Object.freeze({
              status: inferenceFailed ? 'inference_failed' : 'pending_analysis',
              reason: inferenceFailed
                ? 'real inference provider errored — no result fabricated'
                : 'no real inference provider configured — awaiting analysis',
            }),
            status: 'pending_analysis',
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

/**
 * Default inference provider — DELIBERATELY NOT a real vision model.
 *
 * Historically this returned fabricated detections (`detectedObjects:
 * ['building']`, `buildingGuess: 1`) that the pipeline then stamped as a
 * completed `processed` analysis — fake values rendered as real (KI-012,
 * no-mock-in-production invariant).
 *
 * It is now flagged `live: false`. The pipeline reads that flag, skips
 * the stub entirely, and marks captures `pending_analysis` with an
 * honest "awaiting analysis" marker instead of fabricating results.
 * Production wires a real provider (a callable WITHOUT `live: false`, or
 * `live: true`) via `createCapturePipeline({ aiInference })`, which keeps
 * the `processed` path unchanged.
 */
export function defaultAiInference(): AiInferenceFn {
  // The callable body is never invoked while `live === false` (the
  // pipeline short-circuits), but we return an honest empty object so
  // any direct caller also gets no fabricated values.
  const fn: AiInferenceFn = (_capture: FieldCapture, _bytes?: ArrayBuffer | Uint8Array) =>
    Object.freeze({});
  return Object.assign(fn, { live: false as const });
}
