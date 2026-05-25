import { describe, expect, it, vi } from 'vitest';

import { combineVerdicts, runThreeLayerReview } from './combine-verdicts.js';
import {
  CodeRabbitClassReviewer,
  MockDiffReviewer,
} from './layer-2-coderabbit-adapter.js';
import { InlineSubagentReviewer } from './layer-1-inline-subagent.js';
import { UltrareviewReviewer } from './layer-3-ultrareview.js';
import { type ReviewFinding, type ReviewInput, type ReviewVerdict } from './types.js';

const input: ReviewInput = {
  diff: 'diff goes here',
  modifiedFiles: ['packages/x/y.ts'],
  task: { description: 'fix bug' },
};

describe('three-layer-review — Layer 1 (inline subagent)', () => {
  it('passes when no findings', async () => {
    const r = new InlineSubagentReviewer(async () => ({ findings: [] }));
    const v = await r.review(input);
    expect(v.status).toBe('pass');
    expect(v.layer).toBe('inline-subagent');
  });

  it('marks comments for non-critical findings', async () => {
    const findings: ReviewFinding[] = [
      { file: 'x.ts', line: 12, severity: 'warning', message: 'consider X' },
    ];
    const r = new InlineSubagentReviewer(async () => ({ findings }));
    const v = await r.review(input);
    expect(v.status).toBe('comments');
    expect(v.findings).toHaveLength(1);
  });

  it('blocks on critical findings', async () => {
    const findings: ReviewFinding[] = [
      { file: 'x.ts', line: 1, severity: 'critical', message: 'leaks secret' },
    ];
    const r = new InlineSubagentReviewer(async () => ({ findings }));
    const v = await r.review(input);
    expect(v.status).toBe('block');
  });
});

describe('three-layer-review — Layer 2 (CodeRabbit adapter)', () => {
  it('uses the injected diff call', async () => {
    const call = vi.fn(async () => [] as readonly ReviewFinding[]);
    const r = new CodeRabbitClassReviewer(call);
    await r.review(input);
    expect(call).toHaveBeenCalledWith(input);
  });

  it('Mock reviewer returns pass with no findings', async () => {
    const r = new MockDiffReviewer();
    const v = await r.review(input);
    expect(v.status).toBe('pass');
    expect(v.findings).toHaveLength(0);
  });
});

describe('three-layer-review — Layer 3 (ultrareview)', () => {
  const codeownerGlobs = ['**/m-pesa/**', '**/migrations/**'];

  it('returns pass silently when no codeowner glob is touched', async () => {
    const opus = vi.fn(async () => [] as readonly ReviewFinding[]);
    const r = new UltrareviewReviewer({ codeownerGlobs, opusXhighCall: opus });
    const v = await r.review({
      ...input,
      modifiedFiles: ['packages/safe/file.ts'],
    });
    expect(v.status).toBe('pass');
    expect(opus).not.toHaveBeenCalled();
  });

  it('invokes Opus xhigh when codeowner glob is touched', async () => {
    const opus = vi.fn(async () => [] as readonly ReviewFinding[]);
    const r = new UltrareviewReviewer({ codeownerGlobs, opusXhighCall: opus });
    const v = await r.review({
      ...input,
      modifiedFiles: ['packages/connectors/m-pesa/retry.ts'],
    });
    expect(v.status).toBe('pass');
    expect(opus).toHaveBeenCalledOnce();
  });

  it('marks block when Opus xhigh raises a critical finding', async () => {
    const opus = vi.fn(async () => [
      { file: 'x', severity: 'critical', message: 'timing leak' } as ReviewFinding,
    ]);
    const r = new UltrareviewReviewer({ codeownerGlobs, opusXhighCall: opus });
    const v = await r.review({
      ...input,
      modifiedFiles: ['packages/database/src/migrations/2026.ts'],
    });
    expect(v.status).toBe('block');
  });
});

describe('three-layer-review — combineVerdicts', () => {
  const passVerdict: ReviewVerdict = {
    status: 'pass',
    findings: [],
    layer: 'inline-subagent',
  };
  const commentsVerdict: ReviewVerdict = {
    status: 'comments',
    findings: [{ file: 'x', severity: 'warning', message: 'nit' }],
    layer: 'coderabbit-class',
  };
  const blockVerdict: ReviewVerdict = {
    status: 'block',
    findings: [{ file: 'x', severity: 'critical', message: 'leak' }],
    layer: 'ultrareview',
  };

  it('any block → block', () => {
    expect(combineVerdicts([passVerdict, blockVerdict, commentsVerdict]).status).toBe(
      'block',
    );
  });

  it('any comments → comments (no block)', () => {
    expect(combineVerdicts([passVerdict, commentsVerdict]).status).toBe('comments');
  });

  it('all pass → pass', () => {
    expect(combineVerdicts([passVerdict, passVerdict, passVerdict]).status).toBe(
      'pass',
    );
  });

  it('empty list → pass', () => {
    expect(combineVerdicts([]).status).toBe('pass');
  });

  it('concatenates findings across layers', () => {
    const combined = combineVerdicts([commentsVerdict, blockVerdict]);
    expect(combined.findings).toHaveLength(2);
  });
});

describe('three-layer-review — runThreeLayerReview', () => {
  it('throws when reviewers is empty', async () => {
    await expect(runThreeLayerReview(input, [])).rejects.toThrow(/at least one/);
  });

  it('runs all reviewers in parallel and combines', async () => {
    const v = await runThreeLayerReview(input, [
      new InlineSubagentReviewer(async () => ({ findings: [] })),
      new MockDiffReviewer(),
      new UltrareviewReviewer({
        codeownerGlobs: ['x'],
        opusXhighCall: async () => [],
      }),
    ]);
    expect(v.status).toBe('pass');
    expect(v.layer).toBe('combined');
  });
});
