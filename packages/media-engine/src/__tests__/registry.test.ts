/**
 * Provider registry tests.
 */

import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../providers/registry.js';
import { createStubProvider } from '../providers/stub-provider.js';
import { createImagenProvider } from '../providers/image-adapters.js';
import { createSeedanceProvider } from '../providers/video-adapters.js';
import { MediaEngineError } from '../types.js';
import type { MediaProviderId } from '../types.js';

describe('provider registry', () => {
  it('seeds the deterministic stub as the zero-keys floor', () => {
    const registry = createProviderRegistry();
    const stub = registry.get('stub');
    expect(stub).not.toBeNull();
    expect(stub?.requiresKey).toBe(false);
  });

  it('selects the stub for every modality when no keys are present', () => {
    const registry = createProviderRegistry();
    const noKeys = new Set<MediaProviderId>();
    expect(registry.select('image', noKeys).id).toBe('stub');
    expect(registry.select('short_video', noKeys).id).toBe('stub');
    expect(registry.select('gif', noKeys).id).toBe('stub');
  });

  it('prefers a real keyed provider over the stub when its key is present', () => {
    const registry = createProviderRegistry();
    registry.register(createImagenProvider());
    const keyed = new Set<MediaProviderId>(['imagen']);
    expect(registry.select('image', keyed).id).toBe('imagen');
  });

  it('skips a registered real provider whose key is absent', () => {
    const registry = createProviderRegistry();
    registry.register(createImagenProvider());
    // imagen registered but no key ⇒ falls to stub.
    expect(registry.select('image', new Set()).id).toBe('stub');
  });

  it('walks the ladder by modality (seedance preferred for video)', () => {
    const registry = createProviderRegistry();
    registry.register(createSeedanceProvider());
    const keyed = new Set<MediaProviderId>(['seedance']);
    expect(registry.select('short_video', keyed).id).toBe('seedance');
  });

  it('throws on duplicate provider id', () => {
    const registry = createProviderRegistry();
    expect(() => registry.register(createStubProvider())).toThrowError(
      MediaEngineError,
    );
  });

  it('lists providers in insertion order', () => {
    const registry = createProviderRegistry();
    registry.register(createImagenProvider());
    const ids = registry.list().map((p) => p.id);
    expect(ids[0]).toBe('stub');
    expect(ids).toContain('imagen');
  });
});
