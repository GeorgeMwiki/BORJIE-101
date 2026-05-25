/**
 * Policy engine — pure evaluation + YAML parse tests.
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  evaluate,
  loadPolicyFromFile,
  matchesPattern,
  parsePolicyYaml,
  type PolicyRuleset,
} from '../policy-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_YAML_PATH = resolve(
  __dirname,
  '..',
  'policies',
  'baseline.yaml',
);

function loadBaseline(): PolicyRuleset {
  return loadPolicyFromFile(BASELINE_YAML_PATH);
}

describe('matchesPattern', () => {
  it('matches exact strings', () => {
    expect(matchesPattern('navigate-user', 'navigate-user')).toBe(true);
    expect(matchesPattern('navigate-user', 'navigate-admin')).toBe(false);
  });

  it('matches trailing-wildcard patterns', () => {
    expect(matchesPattern('admin-*', 'admin-delete')).toBe(true);
    expect(matchesPattern('admin-*', 'admin-')).toBe(true);
    expect(matchesPattern('admin-*', 'user-delete')).toBe(false);
  });

  it('does not match mid-string wildcards (trailing only)', () => {
    expect(matchesPattern('foo-*-bar', 'foo-x-bar')).toBe(false);
  });
});

describe('parsePolicyYaml', () => {
  it('parses a minimal valid YAML into a frozen ruleset', () => {
    const yaml = `
version: "1.0"
description: "test"
allowedTools:
  - navigate-user
deniedTools:
  - "admin-*"
allowedDbTables: []
deniedDbTables: []
networkEgress: []
humanApproval: []
audit:
  enabled: true
  hashChain: true
  retentionYears: 7
actionClassification: {}
`;
    const policy = parsePolicyYaml(yaml);
    expect(policy.version).toBe('1.0');
    expect(policy.allowedTools).toEqual(['navigate-user']);
    expect(policy.deniedTools).toEqual(['admin-*']);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.allowedTools)).toBe(true);
    expect(Object.isFrozen(policy.audit)).toBe(true);
  });

  it('parses the baseline YAML successfully', () => {
    const policy = loadBaseline();
    expect(policy.version).toBe('1.0');
    expect(policy.allowedTools.length).toBeGreaterThan(0);
    expect(policy.deniedTools).toContain('admin-*');
    expect(policy.networkEgress).toContain('api.anthropic.com');
    expect(policy.audit.enabled).toBe(true);
    expect(policy.audit.retentionYears).toBe(7);
  });

  it('defaults missing fields to safe empty defaults (deny-everything)', () => {
    const policy = parsePolicyYaml('version: "1.0"\ndescription: "minimal"\n');
    expect(policy.allowedTools).toEqual([]);
    expect(policy.deniedTools).toEqual([]);
    expect(policy.audit.enabled).toBe(true);
    expect(policy.audit.retentionYears).toBe(7);
  });
});

describe('evaluate — deny by default', () => {
  it('allows a tool on the allowlist', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'navigate-user' },
      { requestId: 'req-1' },
      policy,
    );
    expect(r.decision).toBe('allow');
    expect(r.matchedRule).toBe('allowedTools');
    expect(r.requestId).toBe('req-1');
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('denies a tool not on any list (deny-by-default)', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'unknown-tool' },
      { requestId: 'req-2' },
      policy,
    );
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('allowedTools:missing');
  });

  it('explicit deny wins over allow', () => {
    const yaml = `
version: "1.0"
description: "deny precedence"
allowedTools:
  - admin-read
  - "admin-*"
deniedTools:
  - admin-read
allowedDbTables: []
deniedDbTables: []
networkEgress: []
humanApproval: []
audit: { enabled: true, hashChain: true, retentionYears: 7 }
actionClassification: {}
`;
    const policy = parsePolicyYaml(yaml);
    const r = evaluate({ toolName: 'admin-read' }, {}, policy);
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('deniedTools');
  });

  it('wildcard deny matches subordinate tools', () => {
    const policy = loadBaseline();
    const r = evaluate({ toolName: 'admin-delete-user' }, {}, policy);
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('deniedTools');
  });
});

describe('evaluate — DB table gates', () => {
  it('denies a tool when its targetTable matches a deny pattern', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'query-properties', targetTable: 'audit_trail' },
      {},
      policy,
    );
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('deniedDbTables');
  });

  it('denies a tool when its targetTable is not on the allowlist', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'query-properties', targetTable: 'undeclared_table' },
      {},
      policy,
    );
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('allowedDbTables:missing');
  });

  it('allows a tool when its targetTable is on the allowlist', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'query-properties', targetTable: 'properties' },
      {},
      policy,
    );
    expect(r.decision).toBe('allow');
  });

  it('wildcard deny matches subordinate tables', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'query-properties', targetTable: 'admin_users' },
      {},
      policy,
    );
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('deniedDbTables');
  });
});

describe('evaluate — network egress', () => {
  it('allows an outbound call to an allowlisted host', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'navigate-user', targetHost: 'api.anthropic.com' },
      {},
      policy,
    );
    expect(r.decision).toBe('allow');
  });

  it('denies an outbound call to a non-allowlisted host', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'navigate-user', targetHost: 'evil.example.com' },
      {},
      policy,
    );
    expect(r.decision).toBe('deny');
    expect(r.matchedRule).toBe('networkEgress:blocked');
  });
});

describe('evaluate — human approval escalation', () => {
  it('escalates a tool on the humanApproval list', () => {
    const policy = loadBaseline();
    const yaml = `
version: "1.0"
description: "approval test"
allowedTools:
  - terminate-lease
deniedTools: []
allowedDbTables: []
deniedDbTables: []
networkEgress: []
humanApproval:
  - terminate-lease
audit: { enabled: true, hashChain: true, retentionYears: 7 }
actionClassification: {}
`;
    const p = parsePolicyYaml(yaml);
    const r = evaluate({ toolName: 'terminate-lease' }, {}, p);
    expect(r.decision).toBe('escalate');
    expect(r.matchedRule).toBe('humanApproval');
    expect(r.requiresHumanApproval).toBe(true);
    // baseline confirmation: the same tool is denied because not on allowlist
    const r2 = evaluate({ toolName: 'terminate-lease' }, {}, policy);
    expect(r2.decision).toBe('deny');
  });
});

describe('evaluate — classification', () => {
  it('classifies a high-sensitivity tool from the baseline', () => {
    const policy = loadBaseline();
    const r = evaluate({ toolName: 'disburse-funds' }, {}, policy);
    // disburse-funds is on humanApproval AND matches "disburse-*" denied
    // → deny wins (deny precedence), but classification still resolved.
    expect(r.decision).toBe('deny');
    expect(r.classification.sensitivity).toBe('high');
    expect(r.classification.reversibility).toBe('irreversible');
    expect(r.classification.complianceTags).toContain('financial');
  });

  it('classifies a low-sensitivity navigation tool', () => {
    const policy = loadBaseline();
    const r = evaluate({ toolName: 'navigate-user' }, {}, policy);
    expect(r.decision).toBe('allow');
    expect(r.classification.sensitivity).toBe('low');
    expect(r.classification.scope).toBe('individual');
  });
});

describe('evaluate — request id propagation', () => {
  it('uses action.requestId when provided', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'navigate-user', requestId: 'from-action' },
      { requestId: 'from-context' },
      policy,
    );
    expect(r.requestId).toBe('from-action');
  });

  it('falls back to context.requestId', () => {
    const policy = loadBaseline();
    const r = evaluate(
      { toolName: 'navigate-user' },
      { requestId: 'from-context' },
      policy,
    );
    expect(r.requestId).toBe('from-context');
  });

  it('generates an id when neither is supplied', () => {
    const policy = loadBaseline();
    const r = evaluate({ toolName: 'navigate-user' }, {}, policy);
    expect(r.requestId).toMatch(/^policy-/);
  });
});

describe('evaluate — purity (no mutation)', () => {
  it('does not mutate the ruleset between calls', () => {
    const policy = loadBaseline();
    const before = JSON.stringify(policy);
    evaluate({ toolName: 'navigate-user' }, {}, policy);
    evaluate({ toolName: 'admin-delete' }, {}, policy);
    evaluate(
      { toolName: 'query-properties', targetTable: 'properties' },
      {},
      policy,
    );
    expect(JSON.stringify(policy)).toBe(before);
  });
});
