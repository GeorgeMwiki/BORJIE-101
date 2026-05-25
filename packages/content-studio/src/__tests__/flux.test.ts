import { describe, expect, it } from 'vitest';
import { createFluxProvider } from '../providers/image/flux.js';
import type { ImageRequest } from '../types.js';

describe('flux provider stub', () => {
  const provider = createFluxProvider();

  const baseReq: ImageRequest = {
    modality: 'image',
    task: 'hero_photoreal',
    prompt: 'Modern Swahili-coast villa exterior, golden hour',
    tenantId: 'tenant-1',
    tenantTier: 'pro',
    seed: 42,
  };

  it('exposes provider id + supported tasks', () => {
    expect(provider.providerId).toBe('flux');
    expect(provider.supportedTasks).toContain('hero_photoreal');
  });

  it('returns deterministic url for same prompt + seed', async () => {
    const a = await provider.generate(baseReq);
    const b = await provider.generate(baseReq);
    expect(a.assets[0]?.url).toBe(b.assets[0]?.url);
    expect(a.assets[0]?.mimeType).toBe('image/png');
    expect(a.modality).toBe('image');
    expect(a.modelId).toBe('flux-1.2-pro-ultra');
  });

  it('varies url when prompt changes', async () => {
    const a = await provider.generate(baseReq);
    const b = await provider.generate({ ...baseReq, prompt: 'something else' });
    expect(a.assets[0]?.url).not.toBe(b.assets[0]?.url);
  });

  it('attaches c2pa manifest with borjie.generation assertion', async () => {
    const result = await provider.generate(baseReq);
    expect(result.c2paManifest.claimGenerator).toContain('borjie.content-studio');
    const bn = result.c2paManifest.assertions.find(
      (a) => a.label === 'borjie.generation',
    );
    expect(bn).toBeDefined();
    expect(bn?.data['provider']).toBe('flux');
    expect(bn?.data['tenantId']).toBe('tenant-1');
  });
});
