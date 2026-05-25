import { describe, expect, it } from 'vitest';
import { EASING, PRESETS, TIMING, reducedMotion } from '../motion-presets.js';

describe('motion-presets', () => {
  it('TIMING is monotonically increasing', () => {
    expect(TIMING.micro).toBeLessThan(TIMING.small);
    expect(TIMING.small).toBeLessThan(TIMING.medium);
    expect(TIMING.medium).toBeLessThan(TIMING.large);
    expect(TIMING.large).toBeLessThan(TIMING.hero);
  });

  it('all easings are 4-tuples', () => {
    for (const [, val] of Object.entries(EASING)) {
      expect(val.length).toBe(4);
    }
  });

  it('PRESETS.tableRowEnter has initial+animate+exit', () => {
    expect(PRESETS.tableRowEnter.initial.opacity).toBe(0);
    expect(PRESETS.tableRowEnter.animate.opacity).toBe(1);
    expect(PRESETS.tableRowEnter.exit.opacity).toBe(0);
  });

  it('PRESETS.modalIn uses standard ease', () => {
    expect(PRESETS.modalIn.transition.ease).toBe(EASING.standard);
  });

  it('reducedMotion collapses to zero-duration linear', () => {
    const r = reducedMotion(PRESETS.modalIn);
    expect(r.transition.duration).toBe(0);
    expect(r.transition.ease).toBe(EASING.linear);
  });

  it('reducedMotion keeps end-state', () => {
    const r = reducedMotion(PRESETS.fade);
    expect(r.initial).toEqual(PRESETS.fade.animate);
    expect(r.animate).toEqual(PRESETS.fade.animate);
    expect(r.exit).toEqual(PRESETS.fade.animate);
  });

  it('duration is expressed in seconds (Framer convention)', () => {
    expect(PRESETS.modalIn.transition.duration).toBe(TIMING.medium / 1000);
  });
});
