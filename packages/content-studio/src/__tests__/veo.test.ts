import { describe, expect, it } from 'vitest';
import { createVeoProvider } from '../providers/video/veo.js';
import type { VideoRequest } from '../types.js';

describe('veo provider stub', () => {
  const provider = createVeoProvider();

  const baseReq: VideoRequest = {
    modality: 'video',
    task: 'sizzle_reel',
    prompt: 'Cinematic dolly through a modern Nairobi townhouse',
    durationSeconds: 8,
    aspectRatio: '9:16',
    tenantId: 't1',
    tenantTier: 'premium',
  };

  it('exposes id + supports tasks', () => {
    expect(provider.providerId).toBe('veo');
    expect(provider.supportedTasks).toContain('sizzle_reel');
    expect(provider.supportedTasks).toContain('i2v_walkthrough');
  });

  it('returns video asset with 9:16 dims', async () => {
    const result = await provider.generate(baseReq);
    expect(result.assets[0]?.mimeType).toBe('video/mp4');
    expect(result.assets[0]?.widthPx).toBe(1080);
    expect(result.assets[0]?.heightPx).toBe(1920);
    expect(result.assets[0]?.durationSeconds).toBe(8);
  });

  it('returns landscape dims for 16:9', async () => {
    const result = await provider.generate({ ...baseReq, aspectRatio: '16:9' });
    expect(result.assets[0]?.widthPx).toBe(1920);
    expect(result.assets[0]?.heightPx).toBe(1080);
  });

  it('cost scales linearly with duration', async () => {
    const short = await provider.generate({ ...baseReq, durationSeconds: 8 });
    const long = await provider.generate({ ...baseReq, durationSeconds: 30 });
    expect(long.costMicrousd).toBe(short.costMicrousd * (30 / 8));
  });

  it('deterministic per prompt+duration+aspect', async () => {
    const a = await provider.generate(baseReq);
    const b = await provider.generate(baseReq);
    expect(a.assets[0]?.url).toBe(b.assets[0]?.url);
  });
});
