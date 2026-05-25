import { describe, expect, it } from 'vitest';

import { promoteSkill, proposeSkill, slugify } from './propose-skill.js';
import { type SkillProposalInput } from './types.js';

const baseInput: SkillProposalInput = {
  taskClass: 'connector-flaky-retry-fix',
  jurisdiction: 'TZ',
  summary: 'Diagnose and fix flaky connector retry logic.',
  steps: [
    'Read connector retry config.',
    'Verify backoff cap >= 2x p99 upstream latency.',
  ],
  verification: ['Run pnpm test against the connector.'],
  successConditions: ['All 4 new unit tests pass.', 'No regressions in CI.'],
  tenantId: 'tenant-borjie',
  modifiedFiles: ['packages/connectors/m-pesa/retry.ts'],
};

describe('skill-emit-on-success — slugify', () => {
  it('lowercases, hyphenates, strips junk', () => {
    expect(slugify('Foo Bar BAZ!')).toBe('foo-bar-baz');
    expect(slugify('  m-pesa  fix  ')).toBe('m-pesa-fix');
    expect(slugify('')).toBe('unnamed-skill');
  });

  it('caps slugs at 60 chars', () => {
    expect(slugify('a'.repeat(120)).length).toBeLessThanOrEqual(60);
  });
});

describe('skill-emit-on-success — proposeSkill', () => {
  it('writes to .claude/skills/_proposed/<slug>/SKILL.md (NEVER auto-promoted)', () => {
    const p = proposeSkill(baseInput, '2026-05-19T00:00:00.000Z');
    expect(p.proposedPath).toContain('.claude/skills/_proposed/');
    expect(p.proposedPath).not.toMatch(/^\.claude\/skills\/[^_]/);
    expect(p.proposedPath).toMatch(/SKILL\.md$/);
  });

  it('emits a frontmatter with task class + jurisdiction + success conditions', () => {
    const p = proposeSkill(baseInput, '2026-05-19T00:00:00.000Z');
    expect(p.frontmatter.taskClass).toBe('connector-flaky-retry-fix');
    expect(p.frontmatter.jurisdiction).toBe('TZ');
    expect(p.frontmatter.successConditions).toHaveLength(2);
    expect(p.frontmatter.tenantId).toBe('tenant-borjie');
  });

  it('renders a status footer that explicitly states the proposal is not auto-discovered', () => {
    const p = proposeSkill(baseInput, '2026-05-19T00:00:00.000Z');
    expect(p.fileContents).toContain('PROPOSED');
    expect(p.fileContents).toContain('K-C HITL promotion');
  });

  it('throws if required fields are missing', () => {
    expect(() => proposeSkill({ ...baseInput, taskClass: '' })).toThrow(/taskClass/);
    expect(() => proposeSkill({ ...baseInput, jurisdiction: '' })).toThrow(
      /jurisdiction/,
    );
    expect(() => proposeSkill({ ...baseInput, successConditions: [] })).toThrow(
      /successConditions/,
    );
  });

  it('produces a deterministic slug from taskClass + jurisdiction', () => {
    const p1 = proposeSkill(baseInput, '2026-05-19T00:00:00.000Z');
    const p2 = proposeSkill(baseInput, '2026-05-20T00:00:00.000Z');
    expect(p1.proposedPath).toBe(p2.proposedPath);
  });
});

describe('skill-emit-on-success — promoteSkill (HITL gate)', () => {
  const p = proposeSkill(baseInput, '2026-05-19T00:00:00.000Z');

  it('returns pending when no approver is provided (NEVER auto-promotes)', () => {
    const d = promoteSkill({ proposal: p });
    expect(d.kind).toBe('pending');
  });

  it('rejects approvers without skill:promote scope', () => {
    const d = promoteSkill({
      proposal: p,
      approverId: '@george',
      approverScopes: ['read'],
    });
    expect(d.kind).toBe('rejected');
  });

  it('promotes when approver holds skill:promote scope', () => {
    const d = promoteSkill({
      proposal: p,
      approverId: '@platform-admin',
      approverScopes: ['skill:promote'],
    });
    expect(d.kind).toBe('promoted');
    if (d.kind === 'promoted') {
      expect(d.promotedPath).not.toContain('_proposed');
      expect(d.promotedPath).toContain('.claude/skills/');
      expect(d.approverId).toBe('@platform-admin');
    }
  });

  it('records an explicit rejection when {rejected} is passed', () => {
    const d = promoteSkill({ proposal: p, rejected: { reason: 'duplicate' } });
    expect(d.kind).toBe('rejected');
  });
});
