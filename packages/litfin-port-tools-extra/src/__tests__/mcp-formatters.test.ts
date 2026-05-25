import { describe, expect, it } from 'vitest';
import {
  formatGitHubPR,
  formatLinearIssue,
  formatSlackMessage,
} from '../mcp-formatters.js';

const UUID = '11111111-2222-3333-4444-555555555555';

describe('mcp-formatters: Slack', () => {
  it('builds basic message', () => {
    const out = formatSlackMessage({
      channel: '#general',
      title: 'Deploy completed',
      body: 'v1.2.3 is live',
    });
    expect(out.channel).toBe('#general');
    expect(out.text).toContain('Deploy completed');
    expect(out.text).toContain('v1.2.3');
    expect(out.unfurlLinks).toBe(false);
  });

  it('includes mentions', () => {
    const out = formatSlackMessage({
      channel: '#x',
      title: 't',
      body: 'b',
      mentions: ['U1', 'U2'],
    });
    expect(out.text).toContain('<@U1>');
    expect(out.text).toContain('<@U2>');
  });

  it('includes bullets', () => {
    const out = formatSlackMessage({
      channel: '#x',
      title: 't',
      body: 'b',
      bullets: ['a', 'b'],
    });
    expect(out.text).toContain('• a');
    expect(out.text).toContain('• b');
  });

  it('honours threadTs', () => {
    const out = formatSlackMessage({
      channel: '#x',
      title: 't',
      body: 'b',
      threadTs: '12345.6789',
    });
    expect(out.threadTs).toBe('12345.6789');
  });
});

describe('mcp-formatters: Linear', () => {
  it('builds minimal issue', () => {
    const out = formatLinearIssue({ teamId: UUID, title: 'Bug X' });
    expect(out.teamId).toBe(UUID);
    expect(out.title).toBe('Bug X');
  });

  it('maps priority strings to numbers', () => {
    expect(formatLinearIssue({ teamId: UUID, title: 'x', priority: 'urgent' }).priority).toBe(1);
    expect(formatLinearIssue({ teamId: UUID, title: 'x', priority: 'low' }).priority).toBe(4);
  });

  it('passes through optional fields', () => {
    const out = formatLinearIssue({
      teamId: UUID,
      title: 'x',
      labelIds: [UUID],
      assigneeId: UUID,
      estimate: 3,
      description: 'desc',
    });
    expect(out.labels).toEqual([UUID]);
    expect(out.assigneeId).toBe(UUID);
    expect(out.estimate).toBe(3);
    expect(out.description).toBe('desc');
  });

  it('rejects non-UUID team id', () => {
    expect(() => formatLinearIssue({ teamId: 'not-a-uuid', title: 'x' })).toThrow();
  });

  it('rejects empty title', () => {
    expect(() => formatLinearIssue({ teamId: UUID, title: '' })).toThrow();
  });
});

describe('mcp-formatters: GitHub PR', () => {
  it('builds body with summary bullets', () => {
    const out = formatGitHubPR({
      title: 'Add X',
      summaryBullets: ['feature A', 'feature B'],
    });
    expect(out.title).toBe('Add X');
    expect(out.body).toContain('## Summary');
    expect(out.body).toContain('- feature A');
  });

  it('includes test plan checkboxes', () => {
    const out = formatGitHubPR({
      title: 't',
      summaryBullets: ['x'],
      testPlan: ['Run unit tests'],
    });
    expect(out.body).toContain('## Test plan');
    expect(out.body).toContain('- [ ] Run unit tests');
  });

  it('includes breaking changes when present', () => {
    const out = formatGitHubPR({
      title: 't',
      summaryBullets: ['x'],
      breakingChanges: ['API removed'],
    });
    expect(out.body).toContain('## Breaking changes');
    expect(out.body).toContain('- API removed');
  });

  it('skips optional sections when empty', () => {
    const out = formatGitHubPR({ title: 't', summaryBullets: ['x'] });
    expect(out.body).not.toContain('## Test plan');
    expect(out.body).not.toContain('## Breaking changes');
  });

  it('includes related issues when given', () => {
    const out = formatGitHubPR({
      title: 't',
      summaryBullets: ['x'],
      relatedIssues: ['#123'],
    });
    expect(out.body).toContain('## Related');
    expect(out.body).toContain('#123');
  });
});
