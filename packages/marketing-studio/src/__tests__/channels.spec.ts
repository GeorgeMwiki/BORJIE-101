/**
 * Channel adapter tests — env-gap behaviour + dispatcher.
 */

import { describe, it, expect } from 'vitest';
import { dispatchChannel, listRegisteredChannels } from '../channels/dispatcher.js';
import type { ComposedAsset } from '../types.js';

const STUB_ASSET: ComposedAsset = Object.freeze({
  id: 'a1',
  class: 'social_post_single' as const,
  channel: 'linkedin_organic' as const,
  variant_id: 'v0',
  body: 'hello',
  attachments: Object.freeze([]),
  span_citations: Object.freeze([]),
  utm_tags: Object.freeze({
    utm_source: 'mr_mwikila',
    utm_medium: 'linkedin_organic',
    utm_campaign: 'r1',
    utm_content: 'v0',
  }),
  publish_authority_tier: 1 as const,
  audit_hash: 'h',
  generated_at: '2026-01-01T00:00:00.000Z',
});

describe('dispatcher', () => {
  it('returns null for unregistered channels', () => {
    expect(dispatchChannel('podcast')).toBeNull();
  });

  it('registers at least 14 channels', () => {
    expect(listRegisteredChannels().length).toBeGreaterThanOrEqual(14);
  });
});

describe('env-gap behaviour', () => {
  it('linkedin returns ENV_GAP when keys absent', async () => {
    const adapter = dispatchChannel('linkedin_organic');
    expect(adapter).not.toBeNull();
    const result = await adapter!.publish(STUB_ASSET, { tenant_id: 't1', env: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ENV_GAP');
    }
  });

  it('email returns ENV_GAP when keys absent', async () => {
    const adapter = dispatchChannel('email');
    expect(adapter).not.toBeNull();
    const result = await adapter!.publish(STUB_ASSET, { tenant_id: 't1', env: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ENV_GAP');
    }
  });

  it('web-landing dry-run produces a permalink', async () => {
    const adapter = dispatchChannel('web_landing');
    expect(adapter).not.toBeNull();
    const result = await adapter!.publish(STUB_ASSET, {
      tenant_id: 't1',
      dry_run: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.permalink).toContain('https://');
    }
  });

  it('linkedin dry-run produces a permalink when env keys present', async () => {
    const adapter = dispatchChannel('linkedin_organic');
    expect(adapter).not.toBeNull();
    const result = await adapter!.publish(STUB_ASSET, {
      tenant_id: 't1',
      dry_run: true,
      env: {
        LINKEDIN_ACCESS_TOKEN: 'fake',
        LINKEDIN_ORG_URN: 'urn:li:organization:1',
      },
    });
    expect(result.ok).toBe(true);
  });
});
