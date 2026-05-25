import { describe, expect, it } from 'vitest';
import { createElevenLabsProvider } from '../providers/voice/elevenlabs.js';
import { createSpitchProvider } from '../providers/voice/spitch.js';
import { createLelapaProvider } from '../providers/voice/lelapa.js';
import { createCartesiaProvider } from '../providers/voice/cartesia.js';
import type { VoiceRequest } from '../types.js';

describe('voice providers', () => {
  describe('elevenlabs stub', () => {
    const provider = createElevenLabsProvider();
    const baseReq: VoiceRequest = {
      modality: 'voice',
      task: 'narration',
      text: 'Karibu nyumbani kwetu. Hii ni nyumba nzuri kwa familia yako.',
      language: 'sw',
      tenantId: 't1',
      tenantTier: 'pro',
    };

    it('supports swahili + english but not yoruba', () => {
      expect(provider.supportsLanguage('sw')).toBe(true);
      expect(provider.supportsLanguage('en-GB')).toBe(true);
      expect(provider.supportsLanguage('yo')).toBe(false);
    });

    it('synthesizes deterministic audio asset', async () => {
      const a = await provider.synthesize(baseReq);
      const b = await provider.synthesize(baseReq);
      expect(a.assets[0]?.url).toBe(b.assets[0]?.url);
      expect(a.assets[0]?.mimeType).toBe('audio/mpeg');
      expect(a.modality).toBe('voice');
    });

    it('cost scales with text length', async () => {
      const short = await provider.synthesize({ ...baseReq, text: 'Hi' });
      const long = await provider.synthesize({
        ...baseReq,
        text: 'A'.repeat(2500),
      });
      expect(long.costMicrousd).toBeGreaterThan(short.costMicrousd);
    });

    it('uses brand voice id when present', async () => {
      const r = await provider.synthesize({
        ...baseReq,
        brand: {
          tenantId: 't1',
          brandName: 'X',
          primaryColorOklch: 'oklch(0.5 0.1 240)',
          fontFamilyHeading: 'Inter',
          fontFamilyBody: 'Inter',
          loraIds: [],
          elevenLabsVoiceId: 'voice-clone-xyz',
        },
      });
      const assertion = r.c2paManifest.assertions.find(
        (a) => a.label === 'borjie.generation',
      );
      expect(assertion?.data['loraIds']).toContain('voice-clone-xyz');
    });
  });

  describe('spitch stub', () => {
    const p = createSpitchProvider();
    it('supports yo/ig/ha', () => {
      expect(p.supportsLanguage('yo')).toBe(true);
      expect(p.supportsLanguage('ig')).toBe(true);
      expect(p.supportsLanguage('ha')).toBe(true);
      expect(p.supportsLanguage('en-ng')).toBe(true);
      expect(p.supportsLanguage('zu')).toBe(false);
    });
    it('synthesizes audio', async () => {
      const r = await p.synthesize({
        modality: 'voice',
        task: 'narration',
        text: 'Bawo ni',
        language: 'yo',
        tenantId: 't1',
        tenantTier: 'pro',
      });
      expect(r.providerId).toBe('spitch');
      expect(r.assets[0]?.mimeType).toBe('audio/mpeg');
    });
  });

  describe('lelapa stub', () => {
    const p = createLelapaProvider();
    it('supports SA bantu langs', () => {
      expect(p.supportsLanguage('zu')).toBe(true);
      expect(p.supportsLanguage('xh')).toBe(true);
      expect(p.supportsLanguage('af')).toBe(true);
      expect(p.supportsLanguage('yo')).toBe(false);
    });
    it('synthesizes audio', async () => {
      const r = await p.synthesize({
        modality: 'voice',
        task: 'narration',
        text: 'Sawubona',
        language: 'zu',
        tenantId: 't1',
        tenantTier: 'pro',
      });
      expect(r.providerId).toBe('lelapa');
    });
  });

  describe('cartesia stub', () => {
    const p = createCartesiaProvider();
    it('supports en + romance langs, not bantu', () => {
      expect(p.supportsLanguage('en')).toBe(true);
      expect(p.supportsLanguage('fr')).toBe(true);
      expect(p.supportsLanguage('sw')).toBe(false);
    });
    it('synthesizes audio', async () => {
      const r = await p.synthesize({
        modality: 'voice',
        task: 'agent_realtime',
        text: 'Hello there',
        language: 'en',
        tenantId: 't1',
        tenantTier: 'pro',
      });
      expect(r.providerId).toBe('cartesia');
    });
  });
});
