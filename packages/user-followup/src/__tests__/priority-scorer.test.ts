import { describe, it, expect } from 'vitest';
import {
  scoreCandidate,
  computeUrgency,
  computeFatigue,
  isCriticalDeadline,
  clamp01,
} from '../scoring/priority-scorer.js';

describe('priority-scorer', () => {
  it('produces a deterministic priority in [0, 1] for a typical input', () => {
    const p = scoreCandidate({
      impact_score: 0.8,
      days_until_deadline: 7,
      attention_score: 0.5,
      repeat_count_this_week: 0,
    });
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
    // Same input → same output.
    const p2 = scoreCandidate({
      impact_score: 0.8,
      days_until_deadline: 7,
      attention_score: 0.5,
      repeat_count_this_week: 0,
    });
    expect(p2).toBe(p);
  });

  it('ranks a regulator deadline ahead of a low-impact dormancy nudge', () => {
    const regulator = scoreCandidate({
      impact_score: 0.9,
      days_until_deadline: 1,
      attention_score: 0.5,
      repeat_count_this_week: 0,
    });
    const dormancy = scoreCandidate({
      impact_score: 0.2,
      days_until_deadline: null,
      attention_score: 0.3,
      repeat_count_this_week: 0,
    });
    expect(regulator).toBeGreaterThan(dormancy);
  });

  it('penalises repeat-this-week candidates via fatigue penalty', () => {
    const fresh = scoreCandidate({
      impact_score: 0.7,
      days_until_deadline: 10,
      attention_score: 0.5,
      repeat_count_this_week: 0,
    });
    const fatigued = scoreCandidate({
      impact_score: 0.7,
      days_until_deadline: 10,
      attention_score: 0.5,
      repeat_count_this_week: 3,
    });
    expect(fatigued).toBeLessThan(fresh);
  });

  it('caps the fatigue penalty so a worst-case priority is still > 0', () => {
    expect(computeFatigue(0)).toBe(0);
    expect(computeFatigue(10)).toBeCloseTo(0.3, 5);
    const worst = scoreCandidate({
      impact_score: 0,
      days_until_deadline: null,
      attention_score: 0,
      repeat_count_this_week: 100,
    });
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThan(0.5);
  });

  it('saturates urgency at zero days remaining', () => {
    expect(computeUrgency(0)).toBe(1);
    expect(computeUrgency(-5)).toBe(1);
    expect(computeUrgency(15)).toBeCloseTo(0.5, 5);
    expect(computeUrgency(null)).toBe(0.3);
  });

  it('flags T-3 and sooner as critical-deadline', () => {
    expect(isCriticalDeadline(0)).toBe(true);
    expect(isCriticalDeadline(2)).toBe(true);
    expect(isCriticalDeadline(3)).toBe(true);
    expect(isCriticalDeadline(4)).toBe(false);
    expect(isCriticalDeadline(null)).toBe(false);
  });

  it('clamps NaN and out-of-range inputs', () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });
});
