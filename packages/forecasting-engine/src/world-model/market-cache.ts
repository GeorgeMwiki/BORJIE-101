/**
 * MarketCache — per-micro-market signals for elasticity + utilisation.
 *
 * Plain in-memory cache. Production wiring (graph-sync, marketing-brain)
 * is intentionally not imported — keeps the simulation engine self-
 * contained and dependency-free.
 */

export interface MicroMarketSignals {
  readonly microMarketId: string;
  readonly medianRoyalty: number;
  readonly availableCapacityRate: number; // 0..1
  readonly daysToContractMedian: number;
  readonly demandIndex: number; // arbitrary, higher = more demand
  readonly updatedAtMs: number;
}

export class MarketCache {
  private readonly map: ReadonlyMap<string, MicroMarketSignals>;

  constructor(map: ReadonlyMap<string, MicroMarketSignals> = new Map()) {
    this.map = map;
  }

  with(signals: MicroMarketSignals): MarketCache {
    const next = new Map(this.map);
    next.set(signals.microMarketId, signals);
    return new MarketCache(next);
  }

  get(microMarketId: string): MicroMarketSignals | undefined {
    return this.map.get(microMarketId);
  }

  getOrDefault(microMarketId: string): MicroMarketSignals {
    return (
      this.map.get(microMarketId) ?? {
        microMarketId,
        medianRoyalty: 0,
        availableCapacityRate: 0.05,
        daysToContractMedian: 30,
        demandIndex: 1,
        updatedAtMs: Date.now(),
      }
    );
  }

  size(): number {
    return this.map.size;
  }
}
