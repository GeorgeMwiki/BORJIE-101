import { describe, it, expect } from 'vitest';
import {
  decideSkillPromotion,
  aggregateSkillSequences,
} from '../skill/skill-composer.js';

describe('skill-composer', () => {
  it('keeps a skill below the invocation threshold at its current status', () => {
    const d = decideSkillPromotion({
      invocations: 2,
      success_rate: 0.95,
      current_status: 'observed',
    });
    expect(d.promote_to).toBe('observed');
    expect(d.reason).toBe('below_invocation_threshold');
  });

  it('keeps a skill with low success rate at its current status', () => {
    const d = decideSkillPromotion({
      invocations: 4,
      success_rate: 0.5,
      current_status: 'observed',
    });
    expect(d.promote_to).toBe('observed');
    expect(d.reason).toBe('below_success_rate');
  });

  it('promotes observed → tested when thresholds met', () => {
    const d = decideSkillPromotion({
      invocations: 3,
      success_rate: 0.9,
      current_status: 'observed',
    });
    expect(d.promote_to).toBe('tested');
    expect(d.reason).toBe('promote_to_tested');
  });

  it('promotes tested → canonical at 3× the invocation threshold', () => {
    const d = decideSkillPromotion({
      invocations: 9,
      success_rate: 0.95,
      current_status: 'tested',
    });
    expect(d.promote_to).toBe('canonical');
    expect(d.reason).toBe('promote_to_canonical');
  });

  it('aggregates 3 identical step-sequences into a canonical sequence', () => {
    const obs = [
      ['t1', 't2', 't3'],
      ['t1', 't2', 't3'],
      ['t1', 't2', 't3'],
    ];
    const canonical = aggregateSkillSequences(obs);
    expect(canonical).toEqual(['t1', 't2', 't3']);
  });

  it('refuses to aggregate divergent step-sequences', () => {
    const obs = [
      ['t1', 't2', 't3'],
      ['t1', 'tX', 't3'],
      ['t1', 't2', 't3'],
    ];
    const canonical = aggregateSkillSequences(obs);
    expect(canonical).toBeNull();
  });

  it('refuses to aggregate fewer than min_observations', () => {
    const obs = [
      ['t1', 't2'],
      ['t1', 't2'],
    ];
    const canonical = aggregateSkillSequences(obs);
    expect(canonical).toBeNull();
  });
});
