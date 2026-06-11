/**
 * Provider registry — the swappable backend catalogue.
 *
 * The default registry contains ONLY the in-repo classical provider, so
 * the engine runs with zero API keys / zero network. The composition
 * root registers foundation-model HTTP providers behind config at
 * bootstrap.
 *
 * Immutable: register/remove return a NEW registry; nothing mutates in
 * place.
 */

import type { ForecastProviderPort } from './port.js';
import { createClassicalProvider } from './classical-provider.js';

export interface ProviderRegistry {
  /** Get a provider by name, or undefined. */
  get(name: string): ForecastProviderPort | undefined;
  /** All registered providers (insertion order). */
  list(): ReadonlyArray<ForecastProviderPort>;
  /** The default classical-floor provider (always present). */
  floor(): ForecastProviderPort;
  /** Return a NEW registry with `provider` added/replaced. */
  register(provider: ForecastProviderPort): ProviderRegistry;
}

function build(
  providers: ReadonlyArray<ForecastProviderPort>,
  floor: ForecastProviderPort,
): ProviderRegistry {
  const byName = new Map<string, ForecastProviderPort>();
  for (const p of providers) byName.set(p.name, p);
  byName.set(floor.name, floor);
  const ordered = [...byName.values()];
  return {
    get(name) {
      return byName.get(name);
    },
    list() {
      return ordered;
    },
    floor() {
      return floor;
    },
    register(provider) {
      const next = ordered.filter((p) => p.name !== provider.name);
      next.push(provider);
      return build(next, floor);
    },
  };
}

export interface CreateRegistryOptions {
  /** Override the classical floor provider (e.g. seasonal_naive). */
  readonly floor?: ForecastProviderPort;
  /** Additional providers to register at construction. */
  readonly providers?: ReadonlyArray<ForecastProviderPort>;
}

/**
 * Build a registry. With no options it contains exactly the default
 * classical (ETS-Theta) floor — runnable with zero configuration.
 */
export function createProviderRegistry(
  options: CreateRegistryOptions = {},
): ProviderRegistry {
  const floor = options.floor ?? createClassicalProvider({ method: 'ets_theta' });
  return build(options.providers ?? [], floor);
}
