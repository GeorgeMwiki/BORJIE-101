/**
 * Layer store — apply / get / merge metadata layers across parcels.
 *
 * Stores layers in versioned form (newest first) so callers can retrieve
 * older recordings. `mergeLayers()` produces a single consolidated view
 * by taking the most recent record of each layer kind.
 */

import type {
  LayerId,
  MetadataLayer,
  MetadataLayerKind,
  ParcelId,
  TenantId,
  UserId,
} from '../types.js';
import { layerSchemaByKind } from './schemas.js';

export interface LayerStore {
  readonly applyLayer: <T extends Record<string, unknown>>(args: {
    readonly parcelId: ParcelId;
    readonly tenantId: TenantId;
    readonly kind: MetadataLayerKind;
    readonly data: T;
    readonly source?: string;
    readonly confidence?: number;
    readonly recordedBy?: UserId;
    readonly recordedAt?: string;
  }) => MetadataLayer<T>;
  readonly getLayer: (
    parcelId: ParcelId,
    kind: MetadataLayerKind,
  ) => MetadataLayer | null;
  readonly getLayerHistory: (
    parcelId: ParcelId,
    kind: MetadataLayerKind,
  ) => ReadonlyArray<MetadataLayer>;
  readonly mergeLayers: (parcelId: ParcelId) => Readonly<Record<MetadataLayerKind, MetadataLayer | null>>;
}

function newId(prefix: string): LayerId {
  // Test-deterministic-friendly id — caller can override by passing recordedAt.
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createInMemoryLayerStore(): LayerStore {
  // parcelId -> kind -> versioned list (newest first)
  const data = new Map<ParcelId, Map<MetadataLayerKind, MetadataLayer[]>>();

  return Object.freeze({
    applyLayer<T extends Record<string, unknown>>(args: {
      readonly parcelId: ParcelId;
      readonly tenantId: TenantId;
      readonly kind: MetadataLayerKind;
      readonly data: T;
      readonly source?: string;
      readonly confidence?: number;
      readonly recordedBy?: UserId;
      readonly recordedAt?: string;
    }): MetadataLayer<T> {
      // Validate if it's a standard kind.
      const schema = (layerSchemaByKind as Record<string, { parse: (x: unknown) => unknown }>)[args.kind];
      let parsedData: unknown = args.data;
      if (schema) {
        parsedData = schema.parse(args.data);
      }
      const layer: MetadataLayer<T> = Object.freeze({
        layerId: newId('lyr'),
        parcelId: args.parcelId,
        tenantId: args.tenantId,
        kind: args.kind,
        data: Object.freeze(parsedData as T),
        ...(args.source !== undefined ? { source: args.source } : {}),
        ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
        recordedAt: args.recordedAt ?? new Date().toISOString(),
        ...(args.recordedBy !== undefined ? { recordedBy: args.recordedBy } : {}),
      }) as MetadataLayer<T>;
      let perParcel = data.get(args.parcelId);
      if (!perParcel) {
        perParcel = new Map();
        data.set(args.parcelId, perParcel);
      }
      let versions = perParcel.get(args.kind);
      if (!versions) {
        versions = [];
        perParcel.set(args.kind, versions);
      }
      versions.unshift(layer as MetadataLayer);
      return layer;
    },
    getLayer(parcelId: ParcelId, kind: MetadataLayerKind): MetadataLayer | null {
      return data.get(parcelId)?.get(kind)?.[0] ?? null;
    },
    getLayerHistory(parcelId: ParcelId, kind: MetadataLayerKind): ReadonlyArray<MetadataLayer> {
      return data.get(parcelId)?.get(kind) ?? [];
    },
    mergeLayers(parcelId: ParcelId): Readonly<Record<MetadataLayerKind, MetadataLayer | null>> {
      const kinds: MetadataLayerKind[] = [
        'legal',
        'physical',
        'financial',
        'environmental',
        'social',
        'infrastructure',
        'custom',
      ];
      const perParcel = data.get(parcelId);
      const out = {} as Record<MetadataLayerKind, MetadataLayer | null>;
      for (const kind of kinds) {
        out[kind] = perParcel?.get(kind)?.[0] ?? null;
      }
      return Object.freeze(out);
    },
  });
}
