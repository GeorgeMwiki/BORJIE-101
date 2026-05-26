/**
 * Provider registry — indexed by (capability, language).
 *
 * Pluggable. The downstream waves register concrete providers
 * (gemini-live, openai-realtime, eleven-v3, polly-neural,
 * gcp-stt, gcp-tts, whisper-large-v3, meta-mms, lelapa-vulavula,
 * spitch) by calling `register(port)` at boot.
 *
 * Lookup returns providers that:
 *
 *   1. Implement the requested capability.
 *   2. Support the requested language.
 *
 * The registry is in-memory and per-process — federation across
 * tenants does not share provider rosters; each tenant's router pins
 * its own provider quality vector to the global registry by reading
 * the `language_provider_quality` table.
 */

import {
  LanguageSotaError,
  type Language,
  type ProviderCapability,
  type ProviderPort,
} from '../types.js';

export interface ProviderRegistry {
  register(port: ProviderPort): void;
  list(): ReadonlyArray<ProviderPort>;
  findBy(
    capability: ProviderCapability,
    lang: Language,
  ): ReadonlyArray<ProviderPort>;
  findById(id: string): ProviderPort | null;
}

export function createProviderRegistry(): ProviderRegistry {
  const ports = new Map<string, ProviderPort>();

  return {
    register(port) {
      if (ports.has(port.id)) {
        throw new LanguageSotaError(
          'duplicate-provider',
          `provider already registered: ${port.id}`,
        );
      }
      // The port itself is treated as immutable — the registry never
      // hands a mutable reference back to callers.
      const frozenPort: ProviderPort = Object.freeze({
        ...port,
        capabilities: Object.freeze([...port.capabilities]),
        supportedLanguages: Object.freeze([...port.supportedLanguages]),
      });
      ports.set(port.id, frozenPort);
    },

    list() {
      return Object.freeze([...ports.values()]);
    },

    findBy(capability, lang) {
      const out: ProviderPort[] = [];
      for (const p of ports.values()) {
        if (
          p.capabilities.includes(capability) &&
          p.supportedLanguages.includes(lang)
        ) {
          out.push(p);
        }
      }
      return Object.freeze(out);
    },

    findById(id) {
      return ports.get(id) ?? null;
    },
  };
}
