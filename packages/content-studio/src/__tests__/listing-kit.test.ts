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
import { createBrandProfile } from '../brand/brand-profile.js';
import { createInMemoryLoraRegistry } from '../brand/lora-registry.js';
import { generateListingKit } from '../workflows/listing-kit.js';
import { generateOwnerReportVideo } from '../workflows/owner-monthly-report-video.js';

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

describe('listing-kit workflow', () => {
  const router = makeRouter();
  const brand = createBrandProfile({
    tenantId: 't1',
    brandName: 'Boss Estates',
    primaryColorOklch: 'oklch(0.55 0.18 240)',
    loraIds: ['lora-v1'],
  });

  it('composes restage + caption + reel + narration', async () => {
    const kit = await generateListingKit(router, {
      tenantId: 't1',
      tenantTier: 'pro',
      listingId: 'listing-42',
      phonePhotoUrl: 'https://uploads.x/photo.jpg',
      editPrompt: 'stage as modern coastal living room',
      captionText: 'FOR RENT — KSh 80,000/mo',
      reelPrompt: 'slow dolly through living room',
      narrationText: 'Karibu nyumbani kwetu',
      narrationLanguage: 'sw',
      brand,
    });

    expect(kit.listingId).toBe('listing-42');
    expect(kit.stagedHero.providerId).toBe('nano-banana');
    expect(kit.captionedBanner.providerId).toBe('ideogram');
    expect(kit.sizzleReel.providerId).toBe('veo');
    expect(kit.narration.providerId).toBe('elevenlabs');
  });

  it('passes brand profile through to providers (lora ids land in c2pa)', async () => {
    const kit = await generateListingKit(router, {
      tenantId: 't1',
      tenantTier: 'pro',
      listingId: 'listing-1',
      phonePhotoUrl: 'https://x/p.jpg',
      editPrompt: 'stage',
      captionText: 'FOR RENT',
      reelPrompt: 'reel',
      narrationText: 'hi',
      narrationLanguage: 'sw',
      brand,
    });
    const stagedAssertion = kit.stagedHero.c2paManifest.assertions.find(
      (a) => a.label === 'borjie.generation',
    );
    expect(stagedAssertion?.data['loraIds']).toEqual(['lora-v1']);
  });
});

describe('owner-monthly-report-video workflow', () => {
  it('produces video + narration with default brand absent', async () => {
    const router = makeRouter();
    const result = await generateOwnerReportVideo(router, {
      tenantId: 't1',
      tenantTier: 'premium',
      ownerId: 'owner-7',
      reportingMonth: '2026-04',
      videoPrompt: 'aerial of portfolio buildings',
      narrationText: 'In April your occupancy averaged 92 percent.',
      narrationLanguage: 'en',
    });

    expect(result.ownerId).toBe('owner-7');
    expect(result.video.modality).toBe('video');
    expect(result.video.assets[0]?.durationSeconds).toBe(30);
    expect(result.narration.modality).toBe('voice');
    expect(result.narration.providerId).toBe('elevenlabs');
  });
});

describe('lora-registry helpers', () => {
  it('register + promote + getPromoted round-trip', async () => {
    const reg = createInMemoryLoraRegistry();
    await reg.register({
      loraId: 'lora-1',
      tenantId: 't1',
      version: 1,
      status: 'staged',
      baseModel: 'flux',
      trainedAtIso: '2026-05-23T00:00:00.000Z',
    });
    await reg.register({
      loraId: 'lora-2',
      tenantId: 't1',
      version: 2,
      status: 'staged',
      baseModel: 'flux',
      trainedAtIso: '2026-05-23T00:00:00.000Z',
    });
    await reg.promote('lora-1');
    let promoted = await reg.getPromoted('t1');
    expect(promoted?.loraId).toBe('lora-1');

    // Promoting lora-2 demotes lora-1 to retired
    await reg.promote('lora-2');
    promoted = await reg.getPromoted('t1');
    expect(promoted?.loraId).toBe('lora-2');
    const all = await reg.listForTenant('t1');
    const lora1 = all.find((r) => r.loraId === 'lora-1');
    expect(lora1?.status).toBe('retired');
  });

  it('retire moves record to retired status', async () => {
    const reg = createInMemoryLoraRegistry();
    await reg.register({
      loraId: 'lora-x',
      tenantId: 't2',
      version: 1,
      status: 'staged',
      baseModel: 'sdxl',
      trainedAtIso: '2026-05-23T00:00:00.000Z',
    });
    await reg.retire('lora-x');
    const all = await reg.listForTenant('t2');
    expect(all[0]?.status).toBe('retired');
  });

  it('throws when promoting unknown lora', async () => {
    const reg = createInMemoryLoraRegistry();
    await expect(reg.promote('nope')).rejects.toThrow(/not found/);
  });

  it('throws when re-registering same lora id', async () => {
    const reg = createInMemoryLoraRegistry();
    await reg.register({
      loraId: 'dup',
      tenantId: 't1',
      version: 1,
      status: 'staged',
      baseModel: 'flux',
      trainedAtIso: '2026-05-23T00:00:00.000Z',
    });
    await expect(
      reg.register({
        loraId: 'dup',
        tenantId: 't1',
        version: 2,
        status: 'staged',
        baseModel: 'flux',
        trainedAtIso: '2026-05-23T00:00:00.000Z',
      }),
    ).rejects.toThrow(/already registered/);
  });
});

describe('brand-profile factory', () => {
  it('applies default fonts when omitted', () => {
    const b = createBrandProfile({
      tenantId: 't',
      brandName: 'Boss',
      primaryColorOklch: 'oklch(0.5 0.1 240)',
    });
    expect(b.fontFamilyHeading).toBe('Inter');
    expect(b.fontFamilyBody).toBe('Inter');
    expect(b.loraIds).toEqual([]);
  });

  it('round-trips all optional fields', () => {
    const b = createBrandProfile({
      tenantId: 't',
      brandName: 'Boss',
      primaryColorOklch: 'oklch(0.5 0.1 240)',
      secondaryColorOklch: 'oklch(0.7 0.05 30)',
      fontFamilyHeading: 'Manrope',
      fontFamilyBody: 'Inter',
      photoStyle: 'cinematic',
      loraIds: ['a', 'b'],
      recraftStyleId: 'style-xyz',
      elevenLabsVoiceId: 'voice-1',
    });
    expect(b.secondaryColorOklch).toBe('oklch(0.7 0.05 30)');
    expect(b.fontFamilyHeading).toBe('Manrope');
    expect(b.photoStyle).toBe('cinematic');
    expect(b.loraIds).toEqual(['a', 'b']);
    expect(b.recraftStyleId).toBe('style-xyz');
    expect(b.elevenLabsVoiceId).toBe('voice-1');
  });
});
