/**
 * Unit tests for the doc-type registry — the "infinite types" surface.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDocTypeRegistry, type DocTypeSpec } from '../doc-type.js';
import { registerCoreDocTypes, CORE_DOC_TYPES } from '../core-doc-types.js';

function makeSpec(id: string): DocTypeSpec {
  return {
    id,
    title: `Doc ${id}`,
    schema: z.object({ x: z.number() }) as unknown as DocTypeSpec['schema'],
    binder: (data) => ({
      templateRef: `${id}/template.typ`,
      view: data as Record<string, unknown>,
      locale: 'en',
      currencyCode: 'TZS',
    }),
    engineHint: 'typst',
    defaultFormats: ['pdf'],
  };
}

describe('doc-type registry', () => {
  it('registers and looks up a type', () => {
    const reg = createDocTypeRegistry();
    reg.register(makeSpec('alpha'));
    expect(reg.has('alpha')).toBe(true);
    expect(reg.get('alpha')?.title).toBe('Doc alpha');
    expect(reg.get('missing')).toBeUndefined();
  });

  it('rejects an empty id', () => {
    const reg = createDocTypeRegistry();
    expect(() => reg.register(makeSpec(''))).toThrow(/non-empty/);
  });

  it('refuses to re-register without overwrite, allows it with overwrite', () => {
    const reg = createDocTypeRegistry();
    reg.register(makeSpec('beta'));
    expect(() => reg.register(makeSpec('beta'))).toThrow(/already registered/);
    expect(() =>
      reg.register(makeSpec('beta'), { overwrite: true }),
    ).not.toThrow();
  });

  it('lists ids sorted + deterministically', () => {
    const reg = createDocTypeRegistry();
    reg.register(makeSpec('zeta'));
    reg.register(makeSpec('alpha'));
    reg.register(makeSpec('mu'));
    expect(reg.ids()).toEqual(['alpha', 'mu', 'zeta']);
    expect(reg.list().length).toBe(3);
  });

  it('supports authored (runtime, bespoke) types alongside core', () => {
    const reg = createDocTypeRegistry();
    registerCoreDocTypes(reg);
    const before = reg.ids().length;
    reg.register({ ...makeSpec('bespoke_letter'), authored: true });
    expect(reg.ids().length).toBe(before + 1);
    expect(reg.get('bespoke_letter')?.authored).toBe(true);
  });
});

describe('core doc-type set', () => {
  it('registers the four core mining types', () => {
    const reg = createDocTypeRegistry();
    registerCoreDocTypes(reg);
    expect(reg.ids()).toEqual([
      'licence_application',
      'monthly_owner_report',
      'offtake_settlement',
      'royalty_statement',
    ]);
    expect(CORE_DOC_TYPES.length).toBe(4);
  });

  it('each core spec carries a schema, binder, engineHint, formats', () => {
    for (const spec of CORE_DOC_TYPES) {
      expect(typeof spec.binder).toBe('function');
      expect(spec.schema).toBeDefined();
      expect(['typst', 'carbone', 'html-pdf']).toContain(spec.engineHint);
      expect(spec.defaultFormats.length).toBeGreaterThan(0);
    }
  });
});
