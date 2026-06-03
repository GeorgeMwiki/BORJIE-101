/**
 * Privacy-routing policy parse + validation tests.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIVACY_POLICY,
  parsePrivacyPolicyYaml,
} from '../index.js';

const VALID_YAML = `
version: "2.0.0"
jurisdiction: "United Republic of Tanzania"
task_category_classification:
  royalty_assessment: CONFIDENTIAL
  blog_generation: PUBLIC
  sanctions_screening: RESTRICTED
restricted_field_prefixes:
  - "compliance."
  - "kyc.raw"
approved_cloud_providers:
  - openai
  - claude
`;

describe('DEFAULT_PRIVACY_POLICY', () => {
  it('is frozen and mining-skinned', () => {
    expect(Object.isFrozen(DEFAULT_PRIVACY_POLICY)).toBe(true);
    expect(DEFAULT_PRIVACY_POLICY.taskCategoryClassification.royalty_assessment).toBe(
      'CONFIDENTIAL',
    );
    expect(DEFAULT_PRIVACY_POLICY.approvedCloudProviders[0]).toBe('claude');
  });
});

describe('parsePrivacyPolicyYaml', () => {
  it('parses a valid snake_case policy and normalises it', () => {
    const p = parsePrivacyPolicyYaml(VALID_YAML);
    expect(p.version).toBe('2.0.0');
    expect(p.taskCategoryClassification.royalty_assessment).toBe('CONFIDENTIAL');
    expect(p.taskCategoryClassification.sanctions_screening).toBe('RESTRICTED');
    expect(p.restrictedFieldPrefixes).toContain('kyc.raw');
    // Provider order preserved: openai first here.
    expect(p.approvedCloudProviders[0]).toBe('openai');
  });

  it('returns a frozen policy', () => {
    const p = parsePrivacyPolicyYaml(VALID_YAML);
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('throws on a non-mapping scalar YAML document', () => {
    expect(() => parsePrivacyPolicyYaml('just-a-string')).toThrowError(
      /must be a mapping/,
    );
  });

  it('throws on a YAML array (object but wrong shape)', () => {
    // A YAML sequence is typeof "object" so it clears the mapping guard
    // and is rejected by schema validation instead.
    expect(() => parsePrivacyPolicyYaml('- a\n- b')).toThrowError(
      /invalid policy/,
    );
  });

  it('throws on an unknown classification value', () => {
    const bad = `
version: "1"
jurisdiction: "TZ"
task_category_classification:
  royalty_assessment: TOP_SECRET
restricted_field_prefixes: []
approved_cloud_providers: [claude]
`;
    expect(() => parsePrivacyPolicyYaml(bad)).toThrowError(/invalid policy/);
  });

  it('throws when no approved providers are listed', () => {
    const bad = `
version: "1"
jurisdiction: "TZ"
task_category_classification: {}
restricted_field_prefixes: []
approved_cloud_providers: []
`;
    expect(() => parsePrivacyPolicyYaml(bad)).toThrowError(/invalid policy/);
  });

  it('throws on malformed YAML syntax', () => {
    expect(() => parsePrivacyPolicyYaml(':\n  - [unbalanced')).toThrow();
  });
});
