/**
 * Registry tests (UNIV-2).
 *
 * Live-test discipline — no mocks. Tests hit the real seed of 30
 * pack definitions and the real in-memory registry.
 */

import { describe, expect, it } from 'vitest';
import {
  PACK_STATUSES,
  SEED_PACK_DEFINITIONS,
  createInMemoryLanguagePackRegistry,
  languagePackDefinitionSchema,
} from '../index.js';

describe('SEED_PACK_DEFINITIONS', () => {
  it('contains exactly 31 pack definitions', () => {
    expect(SEED_PACK_DEFINITIONS.length).toBe(31);
  });

  it('splits 2 live + 29 reserved', () => {
    const live = SEED_PACK_DEFINITIONS.filter((d) => d.status === 'live');
    const reserved = SEED_PACK_DEFINITIONS.filter(
      (d) => d.status === 'reserved',
    );
    expect(live.length).toBe(2);
    expect(reserved.length).toBe(29);
  });

  it('every definition passes the schema', () => {
    for (const def of SEED_PACK_DEFINITIONS) {
      const parsed = languagePackDefinitionSchema.safeParse(def);
      expect(parsed.success).toBe(true);
    }
  });

  it('live packs carry implementationPackage; reserved do not', () => {
    for (const def of SEED_PACK_DEFINITIONS) {
      if (def.status === 'live') {
        expect(def.implementationPackage).not.toBeNull();
      } else {
        expect(def.implementationPackage).toBeNull();
      }
    }
  });

  it('every BCP-47 tag is unique across the seed', () => {
    const tags = SEED_PACK_DEFINITIONS.map((d) => d.bcp47);
    const uniq = new Set(tags);
    expect(uniq.size).toBe(tags.length);
  });
});

describe('createInMemoryLanguagePackRegistry', () => {
  const registry = createInMemoryLanguagePackRegistry({
    telemetry: {
      service: {
        name: '@borjie/language-packs',
        version: 'test',
        environment: 'test',
      },
      level: 'error',
    },
  });

  it('loads all 31 definitions on boot', async () => {
    const all = await registry.listAll();
    expect(all.length).toBe(31);
    expect(registry.count()).toBe(31);
  });

  it('findById resolves the en pack', async () => {
    const en = await registry.findById('en');
    expect(en).not.toBeNull();
    expect(en?.englishName).toBe('English');
    expect(en?.status).toBe('live');
    expect(en?.regionVariants).toContain('en-TZ');
    expect(en?.regionVariants).toContain('en-KE');
    expect(en?.regionVariants).toContain('en-GB');
    expect(en?.regionVariants).toContain('en-US');
    expect(en?.regionVariants).toContain('en-AU');
  });

  it('findById resolves the sw pack with TZ + KE region variants', async () => {
    const sw = await registry.findById('sw');
    expect(sw).not.toBeNull();
    expect(sw?.nativeName).toBe('Kiswahili');
    expect(sw?.status).toBe('live');
    expect(sw?.regionVariants).toEqual(['sw-TZ', 'sw-KE']);
    expect(sw?.morphologyPackageId).toBe('@borjie/swahili-linguistics');
    expect(sw?.macrolanguage).toBe('swa');
  });

  it('findByBcp47 finds zh-CN as a region-locked pack', async () => {
    const zh = await registry.findByBcp47('zh-CN');
    expect(zh).not.toBeNull();
    expect(zh?.script).toBe('Hans');
    expect(zh?.status).toBe('reserved');
  });

  it('marks Arabic as RTL', async () => {
    const ar = await registry.findById('ar');
    expect(ar?.isRtl).toBe(true);
    expect(ar?.script).toBe('Arab');
  });

  it('listByStatus("live") returns the 2 live packs', async () => {
    const live = await registry.listByStatus('live');
    expect(live.length).toBe(2);
    const ids = live.map((p) => p.id).sort();
    expect(ids).toEqual(['en', 'sw']);
  });

  it('listByStatus("reserved") returns the 29 reserved packs', async () => {
    const reserved = await registry.listByStatus('reserved');
    expect(reserved.length).toBe(29);
    expect(reserved.every((p) => p.status === 'reserved')).toBe(true);
    expect(reserved.every((p) => p.implementationPackage === null)).toBe(true);
  });

  it('findById returns null for unknown id', async () => {
    const miss = await registry.findById('xx-XX');
    expect(miss).toBeNull();
  });

  it('findByIso6391 resolves the canonical pack', async () => {
    const en = await registry.findByIso6391('en');
    expect(en?.id).toBe('en');
  });

  it('PACK_STATUSES enumerates exactly live + reserved', () => {
    expect([...PACK_STATUSES].sort()).toEqual(['live', 'reserved']);
  });

  it('African-language cluster (ha, yo, ig, am, so, om, rw, lg, zu, xh, af) all reserved', async () => {
    const africanIds = [
      'ha',
      'yo',
      'ig',
      'am',
      'so',
      'om',
      'rw',
      'lg',
      'zu',
      'xh',
      'af',
    ];
    for (const id of africanIds) {
      const def = await registry.findById(id);
      expect(def).not.toBeNull();
      expect(def?.status).toBe('reserved');
    }
  });

  it('non-Latin script cluster has correct ISO 15924 codes', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['ar', 'Arab'],
      ['zh-CN', 'Hans'],
      ['ru', 'Cyrl'],
      ['uk', 'Cyrl'],
      ['hi', 'Deva'],
      ['ja', 'Jpan'],
      ['ko', 'Kore'],
      ['am', 'Ethi'],
    ];
    for (const [id, script] of cases) {
      const def = await registry.findById(id);
      expect(def?.script).toBe(script);
    }
  });
});

describe('Registry — error handling', () => {
  it('rejects a duplicate id at construction', () => {
    const baseDef = SEED_PACK_DEFINITIONS[0];
    if (baseDef === undefined) {
      throw new Error('seed is empty — test invariant violated');
    }
    const dup = [baseDef, baseDef];
    expect(() =>
      createInMemoryLanguagePackRegistry({
        definitions: dup,
        telemetry: {
          service: {
            name: '@borjie/language-packs',
            version: 'test',
            environment: 'test',
          },
          level: 'error',
        },
      }),
    ).toThrow(/duplicate pack id/i);
  });
});
