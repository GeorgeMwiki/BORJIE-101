import { describe, it, expect } from 'vitest';
import { analyzeEmotionalState } from '../index.js';
import type { EmotionEvidence, BrainPort } from '../../types.js';

describe('analyzeEmotionalState', () => {
  it('does not escalate when emotion timeline is calm', async () => {
    const timeline: EmotionEvidence[] = [
      { timestampMs: 0, emotion: 'calm', score: 0.9 },
      { timestampMs: 1000, emotion: 'joy', score: 0.7 },
    ];
    const result = await analyzeEmotionalState({ emotionTimeline: timeline });
    expect(result.shouldEscalate).toBe(false);
    expect(result.urgency).toBe('low');
    expect(result.triggers).toHaveLength(0);
    expect(result.primaryEmotion).toBe('calm');
  });

  it('escalates on sustained anger (>0.8 across 5s+ span)', async () => {
    const timeline: EmotionEvidence[] = [
      { timestampMs: 0, emotion: 'anger', score: 0.9 },
      { timestampMs: 3000, emotion: 'anger', score: 0.85 },
      { timestampMs: 7000, emotion: 'anger', score: 0.95 },
    ];
    const result = await analyzeEmotionalState({ emotionTimeline: timeline });
    expect(result.shouldEscalate).toBe(true);
    expect(result.triggers).toContain('anger-sustained');
    expect(result.urgency).toBe('high');
    expect(result.primaryEmotion).toBe('anger');
  });

  it('does NOT trigger sustained-anger when span is shorter than 5s', async () => {
    const timeline: EmotionEvidence[] = [
      { timestampMs: 0, emotion: 'anger', score: 0.9 },
      { timestampMs: 2000, emotion: 'anger', score: 0.85 },
    ];
    const result = await analyzeEmotionalState({ emotionTimeline: timeline });
    expect(result.triggers).not.toContain('anger-sustained');
  });

  it('escalates on a single distress spike >0.7', async () => {
    const result = await analyzeEmotionalState({
      emotionTimeline: [{ timestampMs: 100, emotion: 'distress', score: 0.85 }],
    });
    expect(result.triggers).toContain('distress-spike');
    expect(result.urgency).toBe('high');
  });

  it('escalates critically on crying detection', async () => {
    const result = await analyzeEmotionalState({
      emotionTimeline: [{ timestampMs: 0, emotion: 'crying', score: 0.8 }],
    });
    expect(result.triggers).toContain('crying-detected');
    expect(result.urgency).toBe('critical');
    expect(result.primaryEmotion).toBe('crying');
  });

  it('escalates on profanity burst (≥3 in transcript)', async () => {
    const result = await analyzeEmotionalState({
      transcript: 'this is total bullshit, fuck this, what the fuck',
      emotionTimeline: [{ timestampMs: 0, emotion: 'calm', score: 0.5 }],
    });
    expect(result.triggers).toContain('profanity-burst');
  });

  it('falls back to heuristic timeline from transcript when none supplied', async () => {
    const result = await analyzeEmotionalState({
      transcript: 'I am furious and outraged about this',
    });
    expect(result.shouldEscalate).toBe(true);
    expect(result.primaryEmotion).toBe('anger');
  });

  it('uses brain.analyzeEmotion when supplied and no timeline is given', async () => {
    let called = false;
    const brain: BrainPort = {
      analyzeEmotion: async () => {
        called = true;
        return [{ timestampMs: 0, emotion: 'fear', score: 0.9 }];
      },
    };
    const result = await analyzeEmotionalState({ brain, transcript: '' });
    expect(called).toBe(true);
    expect(result.triggers).toContain('fear-detected');
    expect(result.urgency).toBe('critical');
  });
});
