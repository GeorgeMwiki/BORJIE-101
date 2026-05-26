import { describe, it, expect } from 'vitest';
import {
  validateRecipe,
  validateTabRecipe,
  validateDocRecipe,
} from '../validator/recipe-validator.js';

const validTabRaw = {
  id: 'pit-safety-kpis-by-shift',
  intent: 'PitSafetyKpisByShift',
  version: 1,
  status: 'draft' as const,
  telemetry_key: 'pit_safety_kpis_by_shift',
  brand: 'borjie' as const,
  authority_tier: 1 as const,
  form: {
    title_en: 'Pit safety KPIs by shift',
    title_sw: 'KPI za usalama wa shimo kwa zamu',
    groups: [
      {
        id: 'shift-meta',
        title_en: 'Shift metadata',
        title_sw: 'Maelezo ya zamu',
        fields: [
          {
            id: 'shift_id',
            kind: 'text' as const,
            label_en: 'Shift id',
            label_sw: 'Kitambulisho cha zamu',
            required: true,
          },
        ],
      },
      {
        id: 'tumemadini-anchors',
        title_en: 'Tumemadini anchors',
        title_sw: 'Vipengele vya Tumemadini',
        fields: [
          {
            id: 'tumemadini_incident_count',
            kind: 'number' as const,
            label_en: 'Tumemadini incident count',
            label_sw: 'Idadi ya matukio ya Tumemadini',
            required: true,
            required_because: {
              rule: 'Tumemadini §4.2 — incident reporting cadence',
              citation_id: 'TUMEMADINI-4.2',
            },
          },
        ],
      },
    ],
    submit_action: {
      form_id: 'pit-safety-kpis-by-shift',
      url: '/api/gateway/forms/pit-safety-kpis-by-shift',
      method: 'POST' as const,
    },
    evidence_ids: ['TUMEMADINI-4.2'],
  },
};

describe('validateTabRecipe — happy path', () => {
  it('accepts a well-formed Tab Recipe spec and freezes the output', () => {
    const result = validateTabRecipe(validTabRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec['brand']).toBe('borjie');
      expect(result.spec['authority_tier']).toBe(1);
      expect(Object.isFrozen(result.spec)).toBe(true);
    }
  });

  it('routes through validateRecipe(kind, …) by discriminator', () => {
    const result = validateRecipe('tab', validTabRaw);
    expect(result.ok).toBe(true);
  });
});

describe('validateTabRecipe — violations', () => {
  it('rejects a spec whose brand is not the literal "borjie"', () => {
    const bad = { ...validTabRaw, brand: 'acme-cup' };
    const result = validateTabRecipe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toMatch(/brand/i);
    }
  });

  it('rejects a spec with an out-of-range authority_tier', () => {
    const bad = { ...validTabRaw, authority_tier: 5 };
    const result = validateTabRecipe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toMatch(/authority_tier/);
    }
  });

  it('rejects a required regulatory field with no required_because', () => {
    const bad = {
      ...validTabRaw,
      form: {
        ...validTabRaw.form,
        groups: [
          validTabRaw.form.groups[0]!,
          {
            ...validTabRaw.form.groups[1]!,
            fields: [
              {
                id: 'tumemadini_incident_count',
                kind: 'number' as const,
                label_en: 'Tumemadini incident count',
                label_sw: 'Idadi ya matukio ya Tumemadini',
                required: true,
                // required_because intentionally omitted
              },
            ],
          },
        ],
      },
    };
    const result = validateTabRecipe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toMatch(/required_because/);
    }
  });

  it('rejects duplicate field-group ids', () => {
    const bad = {
      ...validTabRaw,
      form: {
        ...validTabRaw.form,
        groups: [
          validTabRaw.form.groups[0]!,
          {
            ...validTabRaw.form.groups[0]!,
            title_en: 'Duplicate id',
          },
        ],
      },
    };
    const result = validateTabRecipe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toMatch(/duplicate group ids/);
    }
  });

  it('rejects a submit_action.url that does not match /api/gateway/forms/<id>', () => {
    const bad = {
      ...validTabRaw,
      form: {
        ...validTabRaw.form,
        submit_action: {
          ...validTabRaw.form.submit_action,
          url: '/some/random/path',
        },
      },
    };
    const result = validateTabRecipe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toMatch(/submit_action.url/);
    }
  });
});

const validDocRaw = {
  id: 'pit-safety-summary',
  class: 'sop' as const,
  version: 1,
  status: 'draft' as const,
  authority_tier: 2 as const,
  brand: 'borjie' as const,
  approval_required: true,
  output_formats: ['pdf', 'docx'] as const,
  required_inputs: [
    { key: 'siteId', description: 'The site id', required: true },
  ],
  required_citations: [
    {
      key: 'tumemadini-incident-cadence',
      description: 'Tumemadini §4.2',
      minCount: 1,
    },
  ],
};

describe('validateDocRecipe', () => {
  it('accepts a well-formed Document Recipe', () => {
    const result = validateDocRecipe(validDocRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec['class']).toBe('sop');
    }
  });

  it('rejects a tier-2 recipe whose approval_required is false', () => {
    const bad = { ...validDocRaw, approval_required: false };
    const result = validateDocRecipe(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('|')).toMatch(/approval_required/);
    }
  });

  it('rejects an unknown document class', () => {
    const bad = { ...validDocRaw, class: 'novel-class' };
    const result = validateDocRecipe(bad);
    expect(result.ok).toBe(false);
  });
});
