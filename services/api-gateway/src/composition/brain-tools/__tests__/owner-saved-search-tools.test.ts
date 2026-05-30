/**
 * owner.saved_search.create — registration + handler smoke tests.
 *
 * Catches the regression that shipped previously: the descriptor was
 * defined and exported but never imported by `index.ts`, so it was
 * dropped from the merged catalog and never reached the brain at boot.
 *
 * Coverage:
 *   - descriptor shape (id, persona scope, stakes, isWrite)
 *   - tool is registered in the merged catalog through index.ts
 *   - handler defers to POST /owner/saved-searches when httpClient is wired
 *   - handler returns the unavailable-shape when no httpClient is present
 *     (so the brain can still hand back a non-throwing response)
 */

import { describe, expect, it, vi } from 'vitest';

import {
  OWNER_SAVED_SEARCH_TOOLS,
  ownerSavedSearchCreateTool,
} from '../owner-saved-search-tools.js';
import { listPersonaToolDescriptors } from '../index.js';

const OWNER_CTX = Object.freeze({
  tenantId: 'tenant-acme',
  actorId: 'user-mwikila',
  personaSlug: 'T1_owner_strategist',
});

describe('ownerSavedSearchCreateTool descriptor', () => {
  it('has the canonical id', () => {
    expect(ownerSavedSearchCreateTool.id).toBe('owner.saved_search.create');
  });

  it('is persona-gated to owner only', () => {
    expect(ownerSavedSearchCreateTool.personaSlugs).toEqual([
      'T1_owner_strategist',
    ]);
  });

  it('is LOW stakes WRITE (alert rule, no money / production)', () => {
    expect(ownerSavedSearchCreateTool.stakes).toBe('LOW');
    expect(ownerSavedSearchCreateTool.isWrite).toBe(true);
    expect(ownerSavedSearchCreateTool.requiresPolicyRuleLiteral).toBe(false);
  });

  it('exports a single tool in OWNER_SAVED_SEARCH_TOOLS', () => {
    expect(OWNER_SAVED_SEARCH_TOOLS).toHaveLength(1);
    expect(OWNER_SAVED_SEARCH_TOOLS[0]?.id).toBe('owner.saved_search.create');
  });
});

describe('ownerSavedSearchCreateTool — registration in brain-tools catalog', () => {
  it('appears in the merged persona-aware tool catalog', () => {
    const ids = listPersonaToolDescriptors().map((d) => d.id);
    expect(ids).toContain('owner.saved_search.create');
  });
});

describe('ownerSavedSearchCreateTool handler', () => {
  it('defers to POST /owner/saved-searches when httpClient is wired', async () => {
    const post = vi.fn(async () => ({
      data: {
        id: 'ss-1',
        label: 'Gold > 22k in Geita',
        frequency: 'daily' as const,
        source: 'marketplace' as const,
        createdAt: '2026-05-30T00:00:00.000Z',
      },
    }));
    const client = { get: vi.fn(async () => ({})), post };
    const result = await ownerSavedSearchCreateTool.handler(
      {
        label: 'Gold > 22k in Geita',
        queryJson: { mineral: 'gold', minPurity: 22 },
        frequency: 'daily',
        source: 'marketplace',
      },
      { ...OWNER_CTX, httpClient: client },
    );
    expect(post).toHaveBeenCalledTimes(1);
    const [path, body] = post.mock.calls[0]!;
    expect(path).toBe('/owner/saved-searches');
    expect((body as Record<string, unknown>).label).toBe('Gold > 22k in Geita');
    expect(result.id).toBe('ss-1');
    expect(result.frequency).toBe('daily');
  });

  it('falls back to an unavailable-shape response when no httpClient is present', async () => {
    const result = await ownerSavedSearchCreateTool.handler(
      {
        label: 'Inactive licences',
        queryJson: {},
        frequency: 'daily',
        source: 'regulatory',
      },
      OWNER_CTX,
    );
    expect(result.id).toBe('unavailable');
    expect(result.label).toBe('Inactive licences');
  });
});
