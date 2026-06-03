import { describe, expect, it, vi } from 'vitest';
import { runJudgeLoop, type GeneratePort, type JudgePort } from '../index.js';

describe('runJudgeLoop', () => {
  it('accepts on the first pass when the score meets the threshold', async () => {
    const generate = vi.fn<GeneratePort>(async () => 'good draft');
    const judge = vi.fn<JudgePort>(async () => ({ score: 90, feedback: '' }));
    const r = await runJudgeLoop('prompt', { generate, judge, threshold: 80 });
    expect(r.accepted).toBe(true);
    expect(r.score).toBe(90);
    expect(r.output).toBe('good draft');
    expect(generate).toHaveBeenCalledOnce();
    expect(r.attempts).toHaveLength(1);
  });

  it('regenerates WITH feedback when below threshold, then accepts', async () => {
    const drafts = ['weak', 'better', 'best'];
    const scores = [40, 70, 95];
    const generate = vi.fn<GeneratePort>(async ({ attempt }) => drafts[attempt - 1]!);
    const judge = vi.fn<JudgePort>(async ({ draft }) => ({
      score: scores[drafts.indexOf(draft)]!,
      feedback: `improve ${draft}`,
    }));
    const r = await runJudgeLoop('p', { generate, judge, threshold: 90, maxAttempts: 3 });
    expect(r.accepted).toBe(true);
    expect(r.output).toBe('best');
    expect(r.attempts).toHaveLength(3);
    // The 2nd generate call must have received the 1st judge's feedback.
    expect(generate).toHaveBeenNthCalledWith(2, expect.objectContaining({ feedback: 'improve weak' }));
  });

  it('returns the BEST attempt when none reach the threshold', async () => {
    const scores = [30, 65, 50];
    let i = 0;
    const generate: GeneratePort = async () => `draft-${i}`;
    const judge: JudgePort = async () => {
      const s = scores[i]!;
      i += 1;
      return { score: s, feedback: 'more' };
    };
    const r = await runJudgeLoop('p', { generate, judge, threshold: 90, maxAttempts: 3 });
    expect(r.accepted).toBe(false);
    expect(r.score).toBe(65); // the best of the three
    expect(r.output).toBe('draft-1');
  });

  it('clamps out-of-range judge scores into [0,100]', async () => {
    const generate: GeneratePort = async () => 'd';
    const judge: JudgePort = async () => ({ score: 9999, feedback: '' });
    const r = await runJudgeLoop('p', { generate, judge, threshold: 80 });
    expect(r.score).toBe(100);
    expect(r.accepted).toBe(true);
  });

  it('treats a non-finite score as 0', async () => {
    const generate: GeneratePort = async () => 'd';
    const judge: JudgePort = async () => ({ score: Number.NaN, feedback: 'x' });
    const r = await runJudgeLoop('p', { generate, judge, threshold: 80, maxAttempts: 1 });
    expect(r.score).toBe(0);
    expect(r.accepted).toBe(false);
  });

  it('respects maxAttempts (always >= 1)', async () => {
    const generate = vi.fn<GeneratePort>(async () => 'd');
    const judge = vi.fn<JudgePort>(async () => ({ score: 10, feedback: 'no' }));
    await runJudgeLoop('p', { generate, judge, threshold: 80, maxAttempts: 0 });
    expect(generate).toHaveBeenCalledOnce(); // floored to 1
  });

  it('ends with the best-so-far when the generator throws mid-loop', async () => {
    let call = 0;
    const generate: GeneratePort = async () => {
      call += 1;
      if (call === 2) throw new Error('gen down');
      return 'first';
    };
    const judge: JudgePort = async () => ({ score: 50, feedback: 'redo' });
    const r = await runJudgeLoop('p', { generate, judge, threshold: 90, maxAttempts: 3 });
    expect(r.output).toBe('first');
    expect(r.score).toBe(50);
    expect(r.attempts).toHaveLength(1);
  });

  it('accepts the current draft when the judge throws', async () => {
    const generate: GeneratePort = async () => 'unjudged';
    const judge: JudgePort = async () => {
      throw new Error('judge down');
    };
    const r = await runJudgeLoop('p', { generate, judge, threshold: 80 });
    expect(r.output).toBe('unjudged');
    expect(r.score).toBe(0);
    expect(r.attempts).toHaveLength(1);
  });

  it('returns empty output scored 0 when the very first generate fails', async () => {
    const generate: GeneratePort = async () => {
      throw new Error('boom');
    };
    const judge: JudgePort = async () => ({ score: 100, feedback: '' });
    const r = await runJudgeLoop('p', { generate, judge });
    expect(r.output).toBe('');
    expect(r.score).toBe(0);
    expect(r.accepted).toBe(false);
    expect(r.attempts).toHaveLength(0);
  });
});
