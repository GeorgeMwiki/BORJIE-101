/**
 * Injected ports for the buyer-marketplace-advisor.
 *
 * Each upstream package is wrapped behind a narrow interface; this lets
 * us compose against in-memory test doubles and keeps coupling thin.
 * The factory provides in-memory defaults so callers can wire only
 * what they need.
 */

import type { KycFact, MineProfile } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Reads mine inventory (production capacity, grade, price). */
export interface MineCatalogPort {
  listMines(args: {
    readonly tenantId: string;
    readonly commodity: string;
  }): Promise<ReadonlyArray<MineProfile>>;
}

/** Reads buyer KYC facts. */
export interface KycSourcePort {
  fetchKycFacts(args: {
    readonly buyerId: string;
    readonly tenantId: string;
  }): Promise<KycFact | null>;
}

/** Reads route + disruption data from geo-intelligence. */
export interface LogisticsPort {
  fetchRoute(args: {
    readonly originMineId: string;
    readonly destPort: string;
  }): Promise<{
    readonly waypoints: ReadonlyArray<string>;
    readonly baseDays: number;
    readonly disruptions: ReadonlyArray<{
      readonly code: string;
      readonly label: string;
      readonly severity: 'low' | 'medium' | 'high';
    }>;
  } | null>;
}

/**
 * In-memory MineCatalogPort — filters a static seed by tenant +
 * commodity. Composition roots replace this with a Drizzle-backed
 * adapter.
 *
 * TODO(wire): replace with `@borjie/mining-commodity-intelligence`
 * adapter that joins LME / KITCO price snapshots with on-chain output.
 */
export function createInMemoryMineCatalog(
  seed: ReadonlyArray<MineProfile>,
): MineCatalogPort {
  return {
    async listMines({ tenantId, commodity }) {
      return seed.filter(
        (m) => m.tenantId === tenantId && m.commodity === commodity,
      );
    },
  };
}

/**
 * In-memory KycSourcePort.
 *
 * TODO(wire): swap for `@borjie/compliance-pack` DSAR + screening read
 * model once Wave-4 lands.
 */
export function createInMemoryKycSource(
  seed: ReadonlyArray<KycFact>,
): KycSourcePort {
  return {
    async fetchKycFacts({ buyerId, tenantId }) {
      return (
        seed.find((k) => k.buyerId === buyerId && k.tenantId === tenantId) ??
        null
      );
    },
  };
}

export interface InMemoryRouteEntry {
  readonly originMineId: string;
  readonly destPort: string;
  readonly waypoints: ReadonlyArray<string>;
  readonly baseDays: number;
  readonly disruptions?: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly severity: 'low' | 'medium' | 'high';
  }>;
}

/**
 * In-memory LogisticsPort.
 *
 * TODO(wire): replace with `@borjie/geo-intelligence` route resolver
 * + `@borjie/geo-parcels` border-crossing overlay.
 */
export function createInMemoryLogistics(
  seed: ReadonlyArray<InMemoryRouteEntry>,
): LogisticsPort {
  return {
    async fetchRoute({ originMineId, destPort }) {
      const hit = seed.find(
        (r) => r.originMineId === originMineId && r.destPort === destPort,
      );
      if (!hit) return null;
      return {
        waypoints: hit.waypoints,
        baseDays: hit.baseDays,
        disruptions: hit.disruptions ?? [],
      };
    },
  };
}
