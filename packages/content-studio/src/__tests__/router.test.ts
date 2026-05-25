import { describe, expect, it } from 'vitest';
import { createContentRouter } from '../router.js';
import { createFluxProvider } from '../providers/image/flux.js';
import { createNanoBananaProvider } from '../providers/image/nano-banana.js';
import { createIdeogramProvider } from '../providers/image/ideogram.js';
import { createRecraftProvider } from '../providers/image/recraft.js';
import { createSdxlSelfHostProvider } from '../providers/image/sdxl-self-host.js';
import { createVeoProvider } from '../providers/video/veo.js';
import { createRunwayProvider } from '../providers/video/runway.js';
import { createElevenLabsProvider } from '../providers/voice/elevenlabs.js';
import { createCartesiaProvider } from '../providers/voice/cartesia.js';
import { createSpitchProvider } from '../providers/voice/spitch.js';
import { createLelapaProvider } from '../providers/voice/lelapa.js';

function makeRouter() {
  return createContentRouter({
    imageProviders: [
      createFluxProvider(),
      createNanoBananaProvider(),
      createIdeogramProvider(),
      createRecraftProvider(),
      createSdxlSelfHostProvider(),
    ],
    videoProviders: [createVeoProvider(), createRunwayProvider()],
    voiceProviders: [
      createElevenLabsProvider(),
      createCartesiaProvider(),
      createSpitchProvider(),
      createLelapaProvider(),
    ],
  });
}

describe('content router', () => {
  const router = makeRouter();

  it('routes hero_photoreal to flux by default', () => {
    const d = router.pick({
      modality: 'image',
      task: 'hero_photoreal',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('flux');
  });

  it('routes text_in_image to ideogram', () => {
    const d = router.pick({
      modality: 'image',
      task: 'text_in_image',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('ideogram');
  });

  it('routes vector_brand to recraft', () => {
    const d = router.pick({
      modality: 'image',
      task: 'vector_brand',
      prompt: 'logo',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('recraft');
  });

  it('routes conversational_edit to nano-banana', () => {
    const d = router.pick({
      modality: 'image',
      task: 'conversational_edit',
      sourceUrl: 'https://x.com/y.jpg',
      editPrompt: 'remove the car',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('nano-banana');
  });

  it('blocks self_hosted_brand for starter tier', () => {
    const d = router.pick({
      modality: 'image',
      task: 'self_hosted_brand',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'starter',
    });
    expect(d).toBeNull();
  });

  it('allows self_hosted_brand for enterprise tier', () => {
    const d = router.pick({
      modality: 'image',
      task: 'self_hosted_brand',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'enterprise',
    });
    expect(d?.providerId).toBe('sdxl-self-host');
  });

  it('floats sdxl-self-host to head when cost=cheap and tier allows', () => {
    const d = router.pick({
      modality: 'image',
      task: 'hero_photoreal',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'enterprise',
      costBudget: 'cheap',
    });
    expect(d?.providerId).toBe('sdxl-self-host');
  });

  it('keeps flux as head when cost=cheap but tier=starter (sdxl blocked)', () => {
    const d = router.pick({
      modality: 'image',
      task: 'hero_photoreal',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'starter',
      costBudget: 'cheap',
    });
    expect(d?.providerId).toBe('flux');
  });

  it('routes sizzle_reel to veo for pro tier', () => {
    const d = router.pick({
      modality: 'video',
      task: 'sizzle_reel',
      prompt: 'cinematic',
      durationSeconds: 8,
      aspectRatio: '9:16',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('veo');
  });

  it('falls back to runway when starter tier requests sizzle_reel (veo gated)', () => {
    const d = router.pick({
      modality: 'video',
      task: 'sizzle_reel',
      prompt: 'cinematic',
      durationSeconds: 8,
      aspectRatio: '9:16',
      tenantId: 't1',
      tenantTier: 'starter',
    });
    expect(d?.providerId).toBe('runway');
  });

  it('routes fast_social_cut to runway by default', () => {
    const d = router.pick({
      modality: 'video',
      task: 'fast_social_cut',
      prompt: 'x',
      durationSeconds: 6,
      aspectRatio: '9:16',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('runway');
  });

  it('routes swahili narration to elevenlabs', () => {
    const d = router.pick({
      modality: 'voice',
      task: 'narration',
      text: 'karibu',
      language: 'sw',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('elevenlabs');
  });

  it('routes yoruba narration to spitch (eleven does not speak it)', () => {
    const d = router.pick({
      modality: 'voice',
      task: 'narration',
      text: 'bawo',
      language: 'yo',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('spitch');
  });

  it('routes zulu narration to lelapa', () => {
    const d = router.pick({
      modality: 'voice',
      task: 'narration',
      text: 'sawubona',
      language: 'zu',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('lelapa');
  });

  it('routes english realtime agent to cartesia (snappiest TTFB)', () => {
    const d = router.pick({
      modality: 'voice',
      task: 'agent_realtime',
      text: 'hello',
      language: 'en',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(d?.providerId).toBe('cartesia');
  });

  it('execute() returns content asset for image', async () => {
    const result = await router.execute({
      modality: 'image',
      task: 'hero_photoreal',
      prompt: 'villa',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(result.providerId).toBe('flux');
    expect(result.assets.length).toBeGreaterThan(0);
  });

  it('execute() returns content asset for video', async () => {
    const result = await router.execute({
      modality: 'video',
      task: 'sizzle_reel',
      prompt: 'cinematic',
      durationSeconds: 8,
      aspectRatio: '16:9',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(result.providerId).toBe('veo');
  });

  it('execute() returns content asset for voice', async () => {
    const result = await router.execute({
      modality: 'voice',
      task: 'narration',
      text: 'karibu',
      language: 'sw',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(result.providerId).toBe('elevenlabs');
  });

  it('execute() invokes edit() for image-edit requests', async () => {
    const result = await router.execute({
      modality: 'image',
      task: 'conversational_edit',
      sourceUrl: 'https://x/photo.jpg',
      editPrompt: 'remove the car',
      tenantId: 't1',
      tenantTier: 'pro',
    });
    expect(result.providerId).toBe('nano-banana');
    expect(result.c2paManifest.ingredients.length).toBe(1);
  });

  it('throws if no provider can serve the request', async () => {
    const empty = createContentRouter({
      imageProviders: [],
      videoProviders: [],
      voiceProviders: [],
    });
    await expect(
      empty.execute({
        modality: 'image',
        task: 'hero_photoreal',
        prompt: 'X',
        tenantId: 't1',
        tenantTier: 'pro',
      }),
    ).rejects.toThrow(/no provider/);
  });

  it('respects user-supplied chain override', () => {
    const r = createContentRouter({
      imageProviders: [createFluxProvider(), createSdxlSelfHostProvider()],
      videoProviders: [],
      voiceProviders: [],
      imageChains: {
        hero_photoreal: ['sdxl-self-host', 'flux'],
      },
    });
    const d = r.pick({
      modality: 'image',
      task: 'hero_photoreal',
      prompt: 'X',
      tenantId: 't1',
      tenantTier: 'enterprise',
    });
    expect(d?.providerId).toBe('sdxl-self-host');
  });
});
