import { describe, expect, it, vi } from 'vitest';

import {
  combineCriticVerdicts,
  DEFAULT_CRITICS,
  runReflexionRound,
} from './run-reflexion.js';
import { type CriticName, type CriticVerdict } from './types.js';

describe('multi-agent-reflexion — DEFAULT_CRITICS', () => {
  it('is exactly the three documented critics', () => {
    expect(DEFAULT_CRITICS).toEqual(['factual', 'senior-eng', 'security']);
  });
});

describe('multi-agent-reflexion — combineCriticVerdicts', () => {
  const pass = (c: CriticName): CriticVerdict => ({
    critic: c,
    status: 'pass',
    findings: [],
  });
  const comments = (c: CriticName): CriticVerdict => ({
    critic: c,
    status: 'comments',
    findings: [{ severity: 'warning', message: 'nit' }],
  });
  const block = (c: CriticName): CriticVerdict => ({
    critic: c,
    status: 'block',
    findings: [{ severity: 'critical', message: 'leak' }],
  });

  it('all pass → pass', () => {
    const r = combineCriticVerdicts([
      pass('factual'),
      pass('senior-eng'),
      pass('security'),
    ]);
    expect(r.verdict).toBe('pass');
    expect(r.findings).toHaveLength(0);
  });

  it('one block → block, even if others pass', () => {
    const r = combineCriticVerdicts([
      pass('factual'),
      pass('senior-eng'),
      block('security'),
    ]);
    expect(r.verdict).toBe('block');
  });

  it('one comments + rest pass → comments', () => {
    const r = combineCriticVerdicts([
      comments('factual'),
      pass('senior-eng'),
      pass('security'),
    ]);
    expect(r.verdict).toBe('comments');
  });

  it('any disagreement (one not-pass) → not pass', () => {
    const r = combineCriticVerdicts([
      pass('factual'),
      comments('senior-eng'),
      pass('security'),
    ]);
    expect(r.verdict).not.toBe('pass');
  });

  it('tags each finding with its critic', () => {
    const r = combineCriticVerdicts([comments('senior-eng'), block('security')]);
    expect(r.findings.map((f) => f.critic).sort()).toEqual(['security', 'senior-eng']);
  });
});

describe('multi-agent-reflexion — runReflexionRound', () => {
  it('runs all critics in parallel', async () => {
    const calls: CriticName[] = [];
    const reviewer = vi.fn(async (input: { critic?: CriticName }) => {
      calls.push(input.critic as CriticName);
      return { verdict: 'pass' as const, findings: [] };
    });
    const r = await runReflexionRound({
      draft: { diffSummary: 'd', modifiedFiles: ['f.ts'] },
      critics: DEFAULT_CRITICS,
      reviewer,
    });
    expect(r.verdict).toBe('pass');
    expect(reviewer).toHaveBeenCalledTimes(3);
    expect(calls.sort()).toEqual(['factual', 'security', 'senior-eng']);
  });

  it('combines results across critics with the documented rule', async () => {
    const reviewer = vi.fn(async (input: { critic?: CriticName }) => {
      if (input.critic === 'security') {
        return {
          verdict: 'block' as const,
          findings: [{ severity: 'critical' as const, message: 'timing' }],
        };
      }
      return { verdict: 'pass' as const, findings: [] };
    });
    const r = await runReflexionRound({
      draft: { diffSummary: 'd', modifiedFiles: ['f.ts'] },
      critics: DEFAULT_CRITICS,
      reviewer,
    });
    expect(r.verdict).toBe('block');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.critic).toBe('security');
  });

  it('throws when critics is empty', async () => {
    await expect(
      runReflexionRound({
        draft: { diffSummary: '', modifiedFiles: [] },
        critics: [],
        reviewer: async () => ({ verdict: 'pass', findings: [] }),
      }),
    ).rejects.toThrow(/at least one/);
  });
});
