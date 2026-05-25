import { describe, expect, it } from 'vitest';
import { renderToDiagram } from '../renderer/to-diagram.js';
import { renderToProse } from '../renderer/to-prose.js';
import { arrearsChase } from './fixtures/arrears-chase.aop.js';
import { leaseRenewal } from './fixtures/lease-renewal.aop.js';
import { kraFiling } from './fixtures/kra-filing.aop.js';
import type { AOP } from '../types.js';

/**
 * A "valid Mermaid" check that doesn't depend on a Mermaid runtime: we
 * assert structural rules that the Mermaid parser enforces.
 */
function assertValidMermaid(src: string): void {
  const lines = src.split('\n').filter((l) => l.trim().length > 0);
  expect(lines[0]).toMatch(/^flowchart\s+(TD|LR|TB|RL|BT)$/);
  // No empty node ids
  for (const line of lines.slice(1)) {
    if (line.includes('-->')) {
      const [from, to] = line.split('-->').map((x) => x.trim());
      expect(from!.length).toBeGreaterThan(0);
      expect(to!.length).toBeGreaterThan(0);
    } else {
      // Node line: must start with non-space token
      expect(line.trim().length).toBeGreaterThan(0);
    }
  }
}

describe('renderToDiagram', () => {
  it.each<[string, AOP]>([
    ['arrears-chase', arrearsChase],
    ['lease-renewal', leaseRenewal],
    ['kra-filing', kraFiling],
  ])('produces valid Mermaid for %s', (_name, ast) => {
    const out = renderToDiagram(ast);
    assertValidMermaid(out);
    for (const step of ast.steps) {
      expect(out).toContain(step.id);
    }
  });

  it('emits tool, monitor, and hook node shapes', () => {
    const out = renderToDiagram(arrearsChase);
    expect(out).toContain('send-reminder["'); // tool: square
    expect(out).toContain('wait-3d(["'); // monitor: stadium
    expect(out).toContain('ask-owner-approval{{"'); // hook: hex
  });

  it('emits labelled edges for hooks (approve)', () => {
    const out = renderToDiagram(arrearsChase);
    expect(out).toMatch(/ask-owner-approval -->\|approve\| draft-notice/);
  });
});

describe('renderToProse', () => {
  it('produces a non-empty plain-text summary', () => {
    for (const ast of [arrearsChase, leaseRenewal, kraFiling]) {
      const prose = renderToProse(ast);
      expect(prose).toContain(ast.name);
      expect(prose.split('\n').length).toBeGreaterThan(ast.steps.length);
    }
  });

  it('describes the cron trigger in English', () => {
    expect(renderToProse(arrearsChase)).toContain('Runs on schedule');
    expect(renderToProse(kraFiling)).toContain('Africa/Nairobi');
  });

  it('describes event trigger', () => {
    expect(renderToProse(leaseRenewal)).toContain('lease.t_minus_60d');
  });
});
