/**
 * UTM builder + URL/body application tests.
 */

import { describe, it, expect } from 'vitest';
import {
  applyUtmToBody,
  applyUtmToUrl,
  buildUtmTags,
} from '../telemetry/utm-builder.js';

describe('buildUtmTags', () => {
  it('produces the canonical shape', () => {
    const tags = buildUtmTags({
      channel: 'linkedin_organic',
      recipe_id: 'r1',
      variant_id: 'v0',
    });
    expect(tags.utm_source).toBe('mr_mwikila');
    expect(tags.utm_medium).toBe('linkedin_organic');
    expect(tags.utm_campaign).toBe('r1');
    expect(tags.utm_content).toBe('v0');
  });

  it('includes utm_term when audience_segment supplied', () => {
    const tags = buildUtmTags({
      channel: 'meta_ads',
      recipe_id: 'r2',
      variant_id: 'v1',
      audience_segment: 'mining_owner',
    });
    expect(tags.utm_term).toBe('mining_owner');
  });
});

describe('applyUtmToUrl', () => {
  it('appends UTM params to a URL', () => {
    const tags = buildUtmTags({
      channel: 'x_organic',
      recipe_id: 'r3',
      variant_id: 'v2',
    });
    const next = applyUtmToUrl('https://borjie.co.tz/x', tags);
    expect(next).not.toBeNull();
    expect(next).toContain('utm_source=mr_mwikila');
    expect(next).toContain('utm_medium=x_organic');
    expect(next).toContain('utm_campaign=r3');
    expect(next).toContain('utm_content=v2');
  });

  it('returns null for invalid URLs', () => {
    const tags = buildUtmTags({
      channel: 'x_organic',
      recipe_id: 'r',
      variant_id: 'v',
    });
    expect(applyUtmToUrl('not a url', tags)).toBeNull();
  });
});

describe('applyUtmToBody', () => {
  it('rewrites every URL in the body', () => {
    const tags = buildUtmTags({
      channel: 'email',
      recipe_id: 'r4',
      variant_id: 'v3',
    });
    const body = 'Click https://borjie.co.tz/a or https://borjie.co.tz/b';
    const next = applyUtmToBody(body, tags);
    expect((next.match(/utm_campaign=r4/g) ?? []).length).toBe(2);
  });
});
