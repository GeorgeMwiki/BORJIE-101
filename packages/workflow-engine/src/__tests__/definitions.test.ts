/**
 * Definition registry + built-in definition tests.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_WORKFLOW_DEFINITIONS,
  createDefinitionRegistry,
  findDefinitionById,
  listBuiltInDefinitions,
  WORKFLOW_KINDS,
} from '../index.js';

describe('built-in definitions', () => {
  it('ships at least 10 definitions covering every workflow kind', () => {
    expect(BUILT_IN_WORKFLOW_DEFINITIONS.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(BUILT_IN_WORKFLOW_DEFINITIONS.map((d) => d.kind));
    for (const k of WORKFLOW_KINDS) expect(kinds.has(k)).toBe(true);
  });

  it('every definition has unique id', () => {
    const ids = BUILT_IN_WORKFLOW_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findDefinitionById resolves and returns null for unknowns', () => {
    expect(findDefinitionById('parcel_edit_v1')).not.toBeNull();
    expect(findDefinitionById('does_not_exist')).toBeNull();
  });

  it('lease and maintenance kinds carry elasticPolicyKey', () => {
    const lease = findDefinitionById('new_lease_v1');
    const maint = findDefinitionById('maintenance_completion_v1');
    const po = findDefinitionById('po_approval_v1');
    expect(lease?.elasticPolicyKey).toBe('lease_exception');
    expect(maint?.elasticPolicyKey).toBe('maintenance_cost');
    expect(po?.elasticPolicyKey).toBe('maintenance_cost');
  });

  it('listBuiltInDefinitions matches the array export', () => {
    expect(listBuiltInDefinitions()).toEqual(BUILT_IN_WORKFLOW_DEFINITIONS);
  });
});

describe('definition registry', () => {
  it('tenant-specific override wins over built-in', () => {
    const reg = createDefinitionRegistry();
    reg.register('tenant-A', {
      id: 'parcel_edit_v1',
      kind: 'parcel_edit',
      version: 99,
      name: 'TENANT A override',
      description: 'custom',
      requiredCapability: 'metadata_edit',
      aiReviewRequired: false,
      humanApprovalRequired: false,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    });
    const aSpec = reg.find('tenant-A', 'parcel_edit_v1');
    expect(aSpec?.name).toBe('TENANT A override');
    expect(aSpec?.aiReviewRequired).toBe(false);
    const bSpec = reg.find('tenant-B', 'parcel_edit_v1');
    expect(bSpec?.name).not.toBe('TENANT A override');
  });

  it('listForTenant prefers tenant override and includes built-ins', () => {
    const reg = createDefinitionRegistry();
    reg.register('tenant-A', {
      id: 'parcel_edit_v1',
      kind: 'parcel_edit',
      version: 99,
      name: 'overridden',
      description: '',
      requiredCapability: 'metadata_edit',
      aiReviewRequired: false,
      humanApprovalRequired: false,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    });
    const out = reg.listForTenant('tenant-A');
    const parcelEdit = out.find((d) => d.id === 'parcel_edit_v1');
    expect(parcelEdit?.name).toBe('overridden');
    // Plus all other built-ins still present.
    expect(out.length).toBe(BUILT_IN_WORKFLOW_DEFINITIONS.length);
  });
});
