import { afterEach, describe, it, expect } from 'vitest';
import {
  buildC2paManifest,
  signManifest,
  verifyManifest,
  canonicalize,
  canonicalHash,
  embedManifest,
  extractSidecarManifest,
  fullyVerify,
  buildVisibleWatermark,
  DEFAULT_DEV_KEY,
  type SigningKey,
} from '../index.js';
import { __resetC2paNodeCacheForTests } from '../embed.js';

const baseManifestArgs = {
  title: 'Listing photo — Garden City 4B',
  format: 'image/jpeg',
  providerId: 'flux',
  modelId: 'flux-1.2-pro-ultra',
  prompt: 'modern 4-bed apartment, golden hour, Nairobi skyline',
  tenantId: 'trc-tenant',
  seed: 42,
  loraIds: ['brand-trc-v1'],
  createdAtIso: '2026-05-23T12:00:00.000Z',
};

describe('canonicalize', () => {
  it('produces stable output regardless of input key order', () => {
    const a = canonicalize({ b: 2, a: 1, c: [3, 2, 1] });
    const b = canonicalize({ a: 1, c: [3, 2, 1], b: 2 });
    expect(a).toBe(b);
  });

  it('serializes nested arrays + objects deterministically', () => {
    const v = { x: [{ k: 1 }, { k: 2 }], y: null, z: 'hi' };
    expect(canonicalize(v)).toBe('{"x":[{"k":1},{"k":2}],"y":null,"z":"hi"}');
  });

  it('hashes equivalent values to the same hex', () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });
});

describe('signManifest + verifyManifest', () => {
  it('signs and verifies round-trip with the dev key', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const signed = signManifest(m);
    const v = verifyManifest(signed.manifest);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.keyId).toBe(DEFAULT_DEV_KEY.id);
  });

  it('produces a deterministic signature given the same inputs', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const a = signManifest(m, DEFAULT_DEV_KEY, '2026-05-23T12:00:00.000Z');
    const b = signManifest(m, DEFAULT_DEV_KEY, '2026-05-23T12:00:00.000Z');
    expect(a.signature).toBe(b.signature);
  });

  it('signs with a different key id', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const key: SigningKey = { id: 'tenant-trc', secret: 'super-secret' };
    const signed = signManifest(m, key);
    expect(signed.manifest.claimSignature).toMatch(/^hmac-sha256:tenant-trc:[0-9a-f]+$/);
    expect(verifyManifest(signed.manifest, [key])).toEqual({ ok: true, keyId: 'tenant-trc' });
  });

  it('rejects a tampered manifest (any field change)', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const signed = signManifest(m);
    const tampered = { ...signed.manifest, title: 'tampered title' } as typeof signed.manifest;
    const v = verifyManifest(tampered);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('signature-mismatch');
  });

  it('rejects an unknown signing key', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const signed = signManifest(m, { id: 'rogue', secret: 'x' });
    const v = verifyManifest(signed.manifest); // only knows the dev key
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('unknown-key');
  });

  it('rejects missing signature', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const empty = { ...m, claimSignature: '' };
    const v = verifyManifest(empty);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('missing-signature');
  });

  it('rejects malformed signature header', () => {
    const m = buildC2paManifest(baseManifestArgs);
    const bad = { ...m, claimSignature: 'not-a-valid-format' };
    const v = verifyManifest(bad);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe('malformed-signature');
  });
});

describe('embedManifest', () => {
  it('default strategy is sidecar; sidecarBytes round-trips', async () => {
    const m = buildC2paManifest(baseManifestArgs);
    const signed = signManifest(m).manifest;
    const result = await embedManifest({
      asset: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      assetMime: 'image/jpeg',
      manifest: signed,
    });
    expect(result.strategy).toBe('sidecar');
    expect(result.sidecarBytes).not.toBeNull();
    expect(result.sidecarSuffix).toBe('.c2pa.json');
    expect(result.assetBytes).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    const recovered = extractSidecarManifest(result.sidecarBytes!);
    expect(recovered).not.toBeNull();
    expect(recovered!.title).toBe(signed.title);
    expect(recovered!.claimSignature).toBe(signed.claimSignature);
  });

  it('embedded strategy falls back to sidecar when c2pa-node is unavailable', async () => {
    __resetC2paNodeCacheForTests(null); // force "not installed"
    const m = buildC2paManifest(baseManifestArgs);
    const result = await embedManifest({
      asset: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      assetMime: 'image/png',
      manifest: m,
      strategy: 'embedded',
    });
    // c2pa-node not installed; embed silently degrades to sidecar.
    expect(result.strategy).toBe('sidecar');
    expect(result.sidecarBytes).not.toBeNull();
    __resetC2paNodeCacheForTests(undefined);
  });

  it('embedded strategy returns DIFFERENT bytes when c2pa-node IS available (legacy embed)', async () => {
    // Inject a fake c2pa-node module exposing the legacy `embed()`
    // shape. Proves the real embed code path is reached and the asset
    // bytes are replaced with the signed output (different length and
    // different leading bytes).
    const stubInput = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // jpeg SOI
    const stubOutput = new Uint8Array([
      0xff, 0xd8, 0xff, 0xeb, // jpeg SOI + APP11 marker (JUMBF)
      ...new Array(64).fill(0x42),
    ]);
    __resetC2paNodeCacheForTests({
      async embed(asset, _manifestJson, _mime) {
        // Sanity: the wrapper passes the canonical manifest as a string.
        expect(typeof _manifestJson).toBe('string');
        expect(asset).toEqual(stubInput);
        return stubOutput;
      },
    });

    const m = buildC2paManifest(baseManifestArgs);
    const result = await embedManifest({
      asset: stubInput,
      assetMime: 'image/jpeg',
      manifest: m,
      strategy: 'embedded',
    });

    expect(result.strategy).toBe('embedded');
    expect(result.sidecarBytes).toBeNull();
    expect(result.sidecarSuffix).toBeNull();
    // PROOF the real embed ran: bytes differ from input.
    expect(result.assetBytes).not.toEqual(stubInput);
    expect(result.assetBytes.length).toBeGreaterThan(stubInput.length);
    expect(result.assetBytes).toEqual(stubOutput);

    __resetC2paNodeCacheForTests(undefined);
  });

  it('embedded strategy uses the modern createC2pa() API when present', async () => {
    const stubInput = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const stubOutput = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    let createC2paCalls = 0;
    __resetC2paNodeCacheForTests({
      createC2pa() {
        createC2paCalls += 1;
        return {
          async sign(input) {
            expect(input.asset.mimeType).toBe('image/jpeg');
            expect(input.asset.buffer).toEqual(stubInput);
            expect(typeof input.manifest).toBe('object');
            return { signedAsset: { buffer: stubOutput } };
          },
        };
      },
    });

    const m = buildC2paManifest(baseManifestArgs);
    const result = await embedManifest({
      asset: stubInput,
      assetMime: 'image/jpeg',
      manifest: m,
      strategy: 'embedded',
    });
    expect(result.strategy).toBe('embedded');
    expect(result.assetBytes).toEqual(stubOutput);
    expect(createC2paCalls).toBe(1);
    __resetC2paNodeCacheForTests(undefined);
  });

  afterEach(() => {
    __resetC2paNodeCacheForTests(undefined);
  });

  it('extractSidecarManifest returns null on garbage input', () => {
    expect(extractSidecarManifest(new TextEncoder().encode('not json'))).toBeNull();
    expect(extractSidecarManifest(new Uint8Array([0, 1, 2, 3]))).toBeNull();
  });
});

describe('fullyVerify', () => {
  it('verifies a signed sidecar end-to-end', async () => {
    const m = buildC2paManifest(baseManifestArgs);
    const signed = signManifest(m).manifest;
    const sidecar = await embedManifest({
      asset: new Uint8Array([1, 2, 3]),
      assetMime: 'image/jpeg',
      manifest: signed,
    });
    const result = fullyVerify({
      asset: new Uint8Array([1, 2, 3]),
      sidecarBytes: sidecar.sidecarBytes!,
      keys: [DEFAULT_DEV_KEY],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.title).toBe(signed.title);
  });

  it('reports no-manifest-found when neither sidecar nor embedded is present', () => {
    const result = fullyVerify({
      asset: new Uint8Array([1, 2, 3]),
      keys: [DEFAULT_DEV_KEY],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a tampered sidecar', async () => {
    const m = buildC2paManifest(baseManifestArgs);
    const signed = signManifest(m).manifest;
    const tampered = { ...signed, title: 'altered' };
    const result = fullyVerify({
      asset: new Uint8Array([1, 2, 3]),
      embeddedManifest: tampered,
      keys: [DEFAULT_DEV_KEY],
    });
    expect(result.ok).toBe(false);
  });
});

describe('buildVisibleWatermark', () => {
  it('produces a bottom-right anchored SVG by default', () => {
    const w = buildVisibleWatermark({ assetWidth: 1024, assetHeight: 768 });
    expect(w.svg).toContain('<svg');
    expect(w.svg).toContain('AI Generated');
    expect(w.x).toBeGreaterThan(800); // bottom-right region
    expect(w.y).toBeGreaterThan(600);
  });

  it('localizes the label to Swahili', () => {
    const w = buildVisibleWatermark({ assetWidth: 800, assetHeight: 600, locale: 'sw' });
    expect(w.svg).toContain('Imetengenezwa na AI');
  });

  it('localizes to Luganda', () => {
    const w = buildVisibleWatermark({ assetWidth: 800, assetHeight: 600, locale: 'lug' });
    expect(w.svg).toContain('Eyakolebwawo AI');
  });

  it('compact mode omits the label', () => {
    const w = buildVisibleWatermark({ assetWidth: 1024, assetHeight: 768, compact: true });
    expect(w.svg).not.toContain('AI Generated');
    expect(w.svg).toContain('<rect');
    expect(w.svg).toContain('CR');
  });

  it('respects custom position', () => {
    const tl = buildVisibleWatermark({ assetWidth: 1024, assetHeight: 768, position: 'top-left' });
    expect(tl.x).toBeLessThan(50);
    expect(tl.y).toBeLessThan(50);
  });

  it('clamps invalid opacity to [0, 1]', () => {
    const high = buildVisibleWatermark({ assetWidth: 100, assetHeight: 100, opacity: 5 });
    const low = buildVisibleWatermark({ assetWidth: 100, assetHeight: 100, opacity: -3 });
    expect(high.svg).toContain('opacity="1"');
    expect(low.svg).toContain('opacity="0"');
  });

  it('escapes XML-special characters in custom labels', () => {
    const w = buildVisibleWatermark({ assetWidth: 400, assetHeight: 300, label: '<bad>&"' });
    expect(w.svg).not.toContain('<bad>');
    expect(w.svg).toContain('&lt;bad&gt;');
  });
});
