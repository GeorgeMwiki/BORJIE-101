/**
 * Storage port, async job store, kind catalogue, and arbiter port tests.
 */

import { describe, expect, it } from 'vitest';
import {
  tenantScopedKey,
} from '../storage/storage-port.js';
import { createInMemoryStorage } from '../storage/in-memory-storage.js';
import { createInMemoryJobStore } from '../job/async-job.js';
import {
  allMediaKinds,
  MEDIA_KIND_PROFILES,
  profileForKind,
} from '../kinds.js';
import { decideMediaModality } from '../arbiter/modality-port.js';
import type { MediaArtifact } from '../types.js';

describe('storage port', () => {
  it('composes a tenant-scoped key matching the RLS first-segment convention', () => {
    expect(tenantScopedKey('tenant-a', 'hero.png')).toBe('tenant-a/hero.png');
    expect(tenantScopedKey('tenant-a', '/hero.png')).toBe('tenant-a/hero.png');
  });

  it('rejects an invalid tenant id', () => {
    expect(() => tenantScopedKey('a/b', 'x.png')).toThrowError();
    expect(() => tenantScopedKey('', 'x.png')).toThrowError();
  });

  it('round-trips bytes and mints a deterministic signed URL', async () => {
    const storage = createInMemoryStorage({
      now: () => new Date('2026-06-08T00:00:00.000Z'),
    });
    const body = Uint8Array.from([9, 8, 7]);
    const key = tenantScopedKey('tenant-a', 'art.png');
    await storage.put('tenant-a', key, body, 'image/png');
    expect(Array.from(storage.read('tenant-a', key) ?? [])).toEqual([9, 8, 7]);
    const signed = await storage.sign('tenant-a', key, 3600);
    expect(signed.url).toContain('tenant-a/art.png');
    expect(signed.expiresAt).toBe('2026-06-08T01:00:00.000Z');
  });
});

describe('async job store', () => {
  const artifact = { id: 'a1' } as unknown as MediaArtifact;

  it('transitions queued → running → succeeded immutably', () => {
    const store = createInMemoryJobStore();
    const created = store.create('tenant-a', 'job-1', 't0');
    expect(created.status).toBe('queued');
    const running = store.markRunning('job-1', 't1');
    expect(running?.status).toBe('running');
    expect(created.status).toBe('queued'); // original snapshot unchanged
    const done = store.succeed('job-1', artifact, 't2');
    expect(done?.status).toBe('succeeded');
    expect(done?.artifact).toBe(artifact);
  });

  it('records failures with a typed error code', () => {
    const store = createInMemoryJobStore();
    store.create('tenant-a', 'job-2', 't0');
    const failed = store.fail('job-2', 'provider_failed', 'boom', 't1');
    expect(failed?.status).toBe('failed');
    expect(failed?.errorCode).toBe('provider_failed');
  });

  it('returns null for unknown job ids', () => {
    const store = createInMemoryJobStore();
    expect(store.get('nope')).toBeNull();
    expect(store.markRunning('nope', 't')).toBeNull();
  });
});

describe('kind catalogue', () => {
  it('covers all Borjie + BN typed kinds', () => {
    const kinds = allMediaKinds();
    expect(kinds).toContain('mining_site_map');
    expect(kinds).toContain('equipment_process_diagram');
    expect(kinds).toContain('marketplace_listing_hero');
    expect(kinds).toContain('investor_brand_video');
    expect(kinds).toContain('property_hero');
    expect(kinds).toContain('virtual_staging');
    expect(kinds).toContain('neighbourhood_reel');
    expect(kinds).toHaveLength(7);
  });

  it('maps each kind to a modality + domain', () => {
    expect(MEDIA_KIND_PROFILES.investor_brand_video.modality).toBe(
      'short_video',
    );
    expect(MEDIA_KIND_PROFILES.neighbourhood_reel.modality).toBe('gif');
    expect(MEDIA_KIND_PROFILES.property_hero.domain).toBe('real_estate');
    expect(MEDIA_KIND_PROFILES.mining_site_map.domain).toBe('mining_estate');
  });

  it('returns null for an unknown kind', () => {
    expect(profileForKind('nope')).toBeNull();
  });
});

describe('modality-arbiter port helper', () => {
  it('decides media for a known kind and maps the modality', () => {
    expect(decideMediaModality('mining_site_map')).toEqual({
      useMedia: true,
      modality: 'image',
    });
    expect(decideMediaModality('investor_brand_video').modality).toBe(
      'short_video',
    );
  });

  it('declines media for an unknown kind', () => {
    expect(decideMediaModality('nope')).toEqual({
      useMedia: false,
      modality: null,
    });
  });
});
