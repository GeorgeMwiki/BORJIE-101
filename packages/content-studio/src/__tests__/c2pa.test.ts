import { describe, expect, it } from 'vitest';
import { buildC2paManifest } from '../c2pa/attestation.js';

describe('c2pa attestation', () => {
  const baseArgs = {
    title: 'Test image',
    format: 'image/png',
    providerId: 'flux',
    modelId: 'flux-1.2-pro-ultra',
    prompt: 'A villa',
    tenantId: 't1',
    seed: 1,
    loraIds: ['lora-v1'],
    createdAtIso: '2026-05-23T00:00:00.000Z',
  };

  it('produces deterministic instanceId + signature for same input', () => {
    const a = buildC2paManifest(baseArgs);
    const b = buildC2paManifest(baseArgs);
    expect(a.instanceId).toBe(b.instanceId);
    expect(a.claimSignature).toBe(b.claimSignature);
  });

  it('changes signature when prompt changes', () => {
    const a = buildC2paManifest(baseArgs);
    const b = buildC2paManifest({ ...baseArgs, prompt: 'Different prompt' });
    expect(a.claimSignature).not.toBe(b.claimSignature);
    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it('always emits c2pa.actions + borjie.generation assertions', () => {
    const m = buildC2paManifest(baseArgs);
    const labels = m.assertions.map((a) => a.label);
    expect(labels).toContain('c2pa.actions');
    expect(labels).toContain('borjie.generation');
  });

  it('records prompt hash, model, seed, lora ids in the generation assertion', () => {
    const m = buildC2paManifest(baseArgs);
    const bn = m.assertions.find((a) => a.label === 'borjie.generation');
    expect(bn?.data['model']).toBe('flux-1.2-pro-ultra');
    expect(bn?.data['seed']).toBe(1);
    expect(bn?.data['loraIds']).toEqual(['lora-v1']);
    expect(typeof bn?.data['promptSha256']).toBe('string');
    expect((bn?.data['promptSha256'] as string).length).toBe(64);
  });

  it('signature begins with sha256: prefix', () => {
    const m = buildC2paManifest(baseArgs);
    expect(m.claimSignature.startsWith('sha256:')).toBe(true);
  });

  it('appends ingredients when supplied', () => {
    const m = buildC2paManifest({
      ...baseArgs,
      ingredients: [
        {
          title: 'phone-photo.jpg',
          format: 'image/jpeg',
          hashSha256: 'abc123',
          relationship: 'inputTo',
        },
      ],
    });
    expect(m.ingredients).toHaveLength(1);
    expect(m.ingredients[0]?.relationship).toBe('inputTo');
  });

  it('appends extra assertions', () => {
    const m = buildC2paManifest({
      ...baseArgs,
      extraAssertions: [{ label: 'custom.x', data: { foo: 'bar' } }],
    });
    expect(m.assertions.map((a) => a.label)).toContain('custom.x');
  });
});
