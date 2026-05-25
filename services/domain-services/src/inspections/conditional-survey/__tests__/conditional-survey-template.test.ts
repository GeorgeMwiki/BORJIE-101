/**
 * CONDITIONAL_SURVEY_TEMPLATE — pure template constant.
 */

import { describe, it, expect } from 'vitest';
import { CONDITIONAL_SURVEY_TEMPLATE } from '../conditional-survey-template.js';
import { CONDITIONAL_SURVEY_SEVERITIES } from '../types.js';

describe('CONDITIONAL_SURVEY_TEMPLATE', () => {
  it('has stable id and label', () => {
    expect(CONDITIONAL_SURVEY_TEMPLATE.id).toBe('conditional_survey_default_v1');
    expect(CONDITIONAL_SURVEY_TEMPLATE.label).toBeTruthy();
    expect(CONDITIONAL_SURVEY_TEMPLATE.description).toBeTruthy();
  });

  it('exposes the six standard areas', () => {
    const ids = CONDITIONAL_SURVEY_TEMPLATE.areas.map((a) => a.id);
    expect(ids).toContain('structure');
    expect(ids).toContain('mechanical');
    expect(ids).toContain('electrical');
    expect(ids).toContain('fire_safety');
    expect(ids).toContain('common_areas');
    expect(ids).toContain('interior');
    expect(CONDITIONAL_SURVEY_TEMPLATE.areas).toHaveLength(6);
  });

  it('every area has at least one prompt and a label', () => {
    for (const area of CONDITIONAL_SURVEY_TEMPLATE.areas) {
      expect(area.label).toBeTruthy();
      expect(area.prompts.length).toBeGreaterThan(0);
    }
  });

  it('every default severity is one of the four canonical levels', () => {
    for (const area of CONDITIONAL_SURVEY_TEMPLATE.areas) {
      expect(CONDITIONAL_SURVEY_SEVERITIES).toContain(area.defaultSeverity);
    }
  });

  it('electrical and fire_safety default to high severity', () => {
    const electrical = CONDITIONAL_SURVEY_TEMPLATE.areas.find(
      (a) => a.id === 'electrical',
    );
    const fire = CONDITIONAL_SURVEY_TEMPLATE.areas.find(
      (a) => a.id === 'fire_safety',
    );
    expect(electrical?.defaultSeverity).toBe('high');
    expect(fire?.defaultSeverity).toBe('high');
  });

  it('areas have distinct ids', () => {
    const ids = CONDITIONAL_SURVEY_TEMPLATE.areas.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
