/**
 * Geo-intelligence orchestrator.
 *
 * `createGeoIntelligence({ db?, imagery?, compliance?, c2pa?, ai? })`
 * returns one composed object wiring all subsystems together. Each
 * dependency is optional — the orchestrator falls back to in-memory
 * implementations when a real one isn't wired (test-friendly, mobile-
 * offline-friendly).
 */

import type { Parcel, ParcelId } from './types.js';
import { createInMemoryLayerStore, type LayerStore } from './metadata/index.js';
import {
  createInMemoryEventStore,
  type EventStore,
} from './history/index.js';
import {
  createInMemoryCaptureStore,
  createCapturePipeline,
  defaultAiInference,
  type AiInferenceFn,
  type CaptureStore,
} from './capture/index.js';
import { createSpatialIndex, type SpatialIndex } from './queries/index.js';
import { createParcelGraph, type ParcelGraph } from './associations/index.js';
import {
  createSentinel2Provider,
  createMapboxSatelliteProvider,
  createMapillaryProvider,
  createGenericDroneFeedProvider,
  createPlanetMonthlyProvider,
  type DroneFeedProvider,
  type SatelliteProvider,
  type StreetViewProvider,
} from './imagery/index.js';
import {
  createComplianceEngine,
  type ComplianceEngine,
} from './compliance/index.js';

export interface ImageryDeps {
  readonly satellite: ReadonlyArray<SatelliteProvider>;
  readonly streetView: ReadonlyArray<StreetViewProvider>;
  readonly drone: ReadonlyArray<DroneFeedProvider>;
}

export interface GeoIntelligenceDeps {
  readonly initialParcels?: ReadonlyArray<Parcel>;
  readonly layerStore?: LayerStore;
  readonly eventStore?: EventStore;
  readonly captureStore?: CaptureStore;
  readonly graph?: ParcelGraph;
  readonly imagery?: ImageryDeps;
  readonly compliance?: ComplianceEngine;
  readonly ai?: AiInferenceFn;
}

export interface GeoIntelligence {
  readonly layerStore: LayerStore;
  readonly eventStore: EventStore;
  readonly captureStore: CaptureStore;
  readonly capturePipeline: ReturnType<typeof createCapturePipeline>;
  readonly spatialIndex: SpatialIndex;
  readonly graph: ParcelGraph;
  readonly imagery: ImageryDeps;
  readonly compliance: ComplianceEngine;
  readonly explore: (parcelId: ParcelId) => Promise<{
    readonly parcel: Parcel | null;
    readonly layers: Record<string, unknown>;
    readonly history: ReturnType<EventStore['getHistory']>;
    readonly associations: ReturnType<ParcelGraph['getAssociations']>;
  }>;
}

export function createGeoIntelligence(deps: GeoIntelligenceDeps = {}): GeoIntelligence {
  const layerStore = deps.layerStore ?? createInMemoryLayerStore();
  const eventStore = deps.eventStore ?? createInMemoryEventStore();
  const captureStore = deps.captureStore ?? createInMemoryCaptureStore();
  const ai = deps.ai ?? defaultAiInference();
  const capturePipeline = createCapturePipeline({
    store: captureStore,
    aiInference: ai,
  });
  const graph = deps.graph ?? createParcelGraph();
  const imagery = deps.imagery ?? {
    satellite: [createSentinel2Provider(), createMapboxSatelliteProvider(), createPlanetMonthlyProvider()],
    streetView: [createMapillaryProvider()],
    drone: [createGenericDroneFeedProvider()],
  };
  const compliance = deps.compliance ?? createComplianceEngine();
  const spatialIndex = createSpatialIndex(deps.initialParcels ?? []);

  return Object.freeze({
    layerStore,
    eventStore,
    captureStore,
    capturePipeline,
    spatialIndex,
    graph,
    imagery,
    compliance,
    async explore(parcelId: ParcelId) {
      const parcel = spatialIndex.all().find((p) => p.parcelId === parcelId) ?? null;
      return {
        parcel,
        layers: layerStore.mergeLayers(parcelId),
        history: eventStore.getHistory(parcelId),
        associations: graph.getAssociations(parcelId),
      };
    },
  });
}
