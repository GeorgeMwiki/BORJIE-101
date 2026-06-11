/**
 * Deterministic stub-provider tests.
 */

import { describe, expect, it } from 'vitest';
import { createStubProvider } from '../providers/stub-provider.js';
import { NOOP_LOGGER } from '../types.js';
import type { ProviderInvocation } from '../providers/port.js';

function invocation(
  overrides: Partial<ProviderInvocation> = {},
): ProviderInvocation {
  return {
    modality: 'image',
    prompt: 'p',
    aspectRatio: '1:1',
    durationSec: 0,
    logger: NOOP_LOGGER,
    seed: 'seed-a',
    ...overrides,
  };
}

describe('stub provider', () => {
  it('needs no key and costs nothing', () => {
    const stub = createStubProvider();
    expect(stub.requiresKey).toBe(false);
    expect(stub.estimateCostCents('image', 0)).toBe(0);
  });

  it('emits a valid PNG for image', async () => {
    const out = await createStubProvider().generate(invocation());
    expect(Array.from(out.body.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(out.format).toBe('png');
  });

  it('emits a valid GIF89a for gif', async () => {
    const out = await createStubProvider().generate(
      invocation({ modality: 'gif' }),
    );
    expect(new TextDecoder().decode(out.body.slice(0, 6))).toBe('GIF89a');
    expect(out.format).toBe('gif');
  });

  it('emits a valid MP4 for short_video', async () => {
    const out = await createStubProvider().generate(
      invocation({ modality: 'short_video' }),
    );
    expect(new TextDecoder().decode(out.body.slice(4, 8))).toBe('ftyp');
    expect(out.format).toBe('mp4');
  });

  it('is deterministic — same seed yields identical bytes', async () => {
    const stub = createStubProvider();
    const a = await stub.generate(invocation({ seed: 'x' }));
    const b = await stub.generate(invocation({ seed: 'x' }));
    expect(Array.from(a.body)).toEqual(Array.from(b.body));
  });

  it('varies bytes by seed', async () => {
    const stub = createStubProvider();
    const a = await stub.generate(invocation({ seed: 'x' }));
    const b = await stub.generate(invocation({ seed: 'y' }));
    expect(Array.from(a.body)).not.toEqual(Array.from(b.body));
  });

  it('never claims SynthID', async () => {
    const out = await createStubProvider().generate(invocation());
    expect(out.synthIdPresent).toBe(false);
  });
});
