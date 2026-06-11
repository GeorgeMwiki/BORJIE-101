/**
 * identifier-limit.test.ts — the Postgres 63-byte identifier wall at
 * compile + validate time. Two distinct logical tables sharing their
 * first 63 bytes would silently truncate into one physical table; the
 * compiler must refuse to emit any over-length table/index identifier,
 * and validateSpec must reject an over-length slug.
 */

import { describe, it, expect } from 'vitest';
import {
  PG_IDENTIFIER_MAX_BYTES,
  identifierByteLength,
  exceedsPgIdentifierLimit,
} from '../identifier-limit.js';
import { compileSpec } from '../compile.js';
import { validateSpec } from '../validate.js';
import type { ModuleSpec } from '../types.js';

describe('exceedsPgIdentifierLimit', () => {
  it('accepts a 63-byte identifier and rejects a 64-byte one', () => {
    const sixtyThree = 'a'.repeat(63);
    const sixtyFour = 'a'.repeat(64);
    expect(identifierByteLength(sixtyThree)).toBe(PG_IDENTIFIER_MAX_BYTES);
    expect(exceedsPgIdentifierLimit(sixtyThree)).toBe(false);
    expect(exceedsPgIdentifierLimit(sixtyFour)).toBe(true);
  });
});

function specWithSlug(slug: string): ModuleSpec {
  return {
    entities: [
      {
        slug,
        display_name_en: 'X',
        fields: [{ name: 'name', kind: 'text', required: true }],
      },
    ],
    workflows: [],
    ui_sections: [],
  };
}

describe('compileSpec — identifier-length guard', () => {
  it('rejects when the derived index identifier would exceed 63 bytes', () => {
    // Slug is legal per SLUG_REGEX (≤48). With a long tenantId the
    // derived `tenant_mod_{tenantId}_{slug}_module_idx` overflows 63.
    const longTenant = 't'.repeat(40);
    const longSlug = 's'.repeat(40);
    const r = compileSpec(specWithSlug(longSlug), longTenant);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/63-byte limit/);
    expect(r.tableNames).toEqual([]);
  });

  it('accepts when the derived identifiers all fit within 63 bytes', () => {
    const r = compileSpec(specWithSlug('assay'), 'acme');
    expect(r.ok).toBe(true);
    expect(r.tableNames).toEqual(['tenant_mod_acme_assay']);
  });
});

describe('validateSpec — slug-length bound', () => {
  it('accepts a slug at the SLUG_REGEX ceiling (48 chars)', () => {
    const slug = 'a' + 'b'.repeat(47); // 48 chars, ≤ 63
    expect(validateSpec(specWithSlug(slug)).ok).toBe(true);
  });
});
