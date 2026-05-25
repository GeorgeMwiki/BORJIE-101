import { describe, it, expect } from 'vitest';
import { metadataUpdatePolicy } from '../policies/metadata-update-policy.js';
import { makeReq } from './fixtures.js';

describe('metadataUpdatePolicy', () => {
  it('preChecks reports missing entityId', () => {
    const issues = metadataUpdatePolicy.preChecks(makeReq('metadata_update', {}));
    expect(issues.some((i) => i.code === 'metadata.entity.missing')).toBe(true);
  });

  it('preChecks rejects malformed tags', () => {
    const issues = metadataUpdatePolicy.preChecks(
      makeReq('metadata_update', { entityId: 'e1', tagsToAdd: ['ok', '', 7] }),
    );
    expect(issues.filter((i) => i.code === 'metadata.tag.invalid').length).toBe(2);
  });

  it('redLines blocks reserved tag prefixes', () => {
    const redLines = metadataUpdatePolicy.redLines(
      makeReq('metadata_update', { entityId: 'e1', tagsToAdd: ['system:owner'] }),
    );
    expect(redLines.some((i) => i.code === 'metadata.tag.reserved_prefix')).toBe(true);
  });

  it('redLines blocks clearAllTags without confirmation', () => {
    const redLines = metadataUpdatePolicy.redLines(
      makeReq('metadata_update', { entityId: 'e1', clearAllTags: true }),
    );
    expect(redLines.some((i) => i.code === 'metadata.clear_all.requires_confirmation')).toBe(true);
  });

  it('redLines allows clearAllTags WITH confirmation', () => {
    const redLines = metadataUpdatePolicy.redLines(
      makeReq('metadata_update', {
        entityId: 'e1',
        clearAllTags: true,
        confirmationToken: 'CONFIRM_CLEAR_ALL',
      }),
    );
    expect(redLines).toEqual([]);
  });
});
