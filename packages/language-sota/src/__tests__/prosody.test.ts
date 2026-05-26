import { describe, expect, it } from 'vitest';
import {
  analyseProsody,
  classifyIntonation,
  downsampleF0,
  computeStressBins,
  F0_CONTOUR_BINS,
} from '../prosody/prosody-analyzer.js';
import { buildSsml, escapeXml } from '../prosody/prosody-controller.js';
import type { Prosody } from '../types.js';

describe('prosody F0 extraction', () => {
  it('downsamples a constant trajectory to a constant contour', () => {
    const raw = new Array<number>(160).fill(120);
    const contour = downsampleF0(raw);
    expect(contour).toHaveLength(F0_CONTOUR_BINS);
    expect(contour.every((v) => v === 120)).toBe(true);
  });

  it('detects a rising contour (KiSwahili yes/no question shape)', () => {
    // Ramp up over 160 raw samples, from 100 Hz to 220 Hz.
    const raw: number[] = [];
    for (let i = 0; i < 160; i += 1) raw.push(100 + (i / 159) * 120);
    const contour = downsampleF0(raw);
    const shape = classifyIntonation(contour);
    expect(shape).toBe('rising');
  });

  it('detects a falling contour (declarative shape)', () => {
    const raw: number[] = [];
    for (let i = 0; i < 160; i += 1) raw.push(220 - (i / 159) * 120);
    const contour = downsampleF0(raw);
    expect(classifyIntonation(contour)).toBe('falling');
  });

  it('detects an undulating contour (alarm shape)', () => {
    // Use a high-frequency oscillation so bin-mean preserves the sign-
    // change pattern after downsampling to 16 bins.
    const contour = [
      120, 180, 110, 190, 130, 175, 100, 200, 125, 175, 115, 185, 130, 170,
      120, 180,
    ];
    expect(classifyIntonation(contour)).toBe('undulating');
  });

  it('treats zero / NaN samples as unvoiced and skips them', () => {
    const raw: number[] = [0, 0, 100, 110, 0, 120, NaN, 130, 0, 140];
    const contour = downsampleF0(raw, 4);
    // Even bins with only zeros should report 0, not NaN
    expect(contour.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('analyseProsody produces a complete Prosody envelope', () => {
    const raw = new Array<number>(160).fill(0).map((_, i) => 110 + i * 0.5);
    const prosody = analyseProsody(raw);
    expect(prosody.f0Contour).toHaveLength(F0_CONTOUR_BINS);
    expect(prosody.intonationShape).toBe('rising');
    expect(prosody.stressBins.length).toBeGreaterThan(0);
  });

  it('computeStressBins normalises to [0,1]', () => {
    const contour = [100, 110, 130, 130, 120];
    const stress = computeStressBins(contour);
    expect(stress.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(stress).toContain(1);
  });
});

describe('SSML controller', () => {
  const prosody: Prosody = {
    f0Contour: new Array<number>(16).fill(120),
    stressBins: new Array<number>(8).fill(0.2),
    intonationShape: 'rising',
  };

  it('emits well-formed SSML for a Swahili question', () => {
    const ssml = buildSsml({
      text: 'Habari yako?',
      lang: 'sw',
      prosody,
    });
    expect(ssml.startsWith('<speak version="1.1" xml:lang="sw-TZ">')).toBe(true);
    expect(ssml).toContain('<prosody');
    // rising intonation should add a +2st pitch inner-tag
    expect(ssml).toContain('+2st');
    expect(ssml.endsWith('</speak>')).toBe(true);
  });

  it('emits a falling pitch tag for a declarative shape', () => {
    const fallingProsody: Prosody = { ...prosody, intonationShape: 'falling' };
    const ssml = buildSsml({
      text: 'Asante sana.',
      lang: 'sw',
      prosody: fallingProsody,
    });
    expect(ssml).toContain('-1st');
  });

  it('uses code-switch locale for code-switched utterances', () => {
    const ssml = buildSsml({
      text: 'Mteja anataka tone tano',
      lang: 'code-switch',
      prosody: { ...prosody, intonationShape: 'flat' },
    });
    expect(ssml).toContain('xml:lang="sw-TZ"');
  });

  it('escapeXml escapes the five required entities', () => {
    expect(escapeXml('< > & " \'')).toBe('&lt; &gt; &amp; &quot; &apos;');
  });

  it('emits emphasis tag for undulating shape', () => {
    const undProsody: Prosody = { ...prosody, intonationShape: 'undulating' };
    const ssml = buildSsml({
      text: 'Hatari!',
      lang: 'sw',
      prosody: undProsody,
    });
    expect(ssml).toContain('<emphasis level="strong">');
  });
});
