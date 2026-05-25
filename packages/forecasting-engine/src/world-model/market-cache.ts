/**
 * MarketCache — per-micro-market signals for elasticity + occupancy.
 *
 * Plain in-memory cache. Production wiring (graph-sync, marketing-brain)
 * is intentionally not imported — keeps the simulation engine self-
 * contained and dependency-free.
 */

export interface MicroMarketSignals {
  readonly microMarketId: string;
  readonly medianRent: number;
  readonly vacancyRate: number; // 0..1
  readonly daysToLeaseMedian: number;
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
        medianRent: 0,
        vacancyRate: 0.05,
        daysToLeaseMedian: 30,
        demandIndex: 1,
        updatedAtMs: Date.now(),
      }
    );
  }

  size(): number {
    return this.map.size;
  }
}
