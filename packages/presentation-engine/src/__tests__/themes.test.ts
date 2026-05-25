/**
 * Theme parity test — TS mirror ⇔ migration 0209 seed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILT_IN_THEMES, InMemoryThemeStore } from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(
  here,
  '..',
  '..',
  '..',
  'database',
  'src',
  'migrations',
  '0209_presentation_themes.sql',
);

function extractSlugs(): string[] {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const matches = Array.from(sql.matchAll(/'theme_([a-z0-9_]+)',/g)).map(
    (m) => m[1]!,
  );
  return [...new Set(matches)];
}

describe('BUILT_IN_THEMES ↔ migration 0209', () => {
  const slugs = extractSlugs();

  it('migration seeds 5 themes', () => {
    expect(slugs.length).toBe(5);
  });

  it('every TS mirror slug is in the SQL seed', () => {
    for (const slug of Object.keys(BUILT_IN_THEMES)) {
      expect(slugs).toContain(slug);
    }
  });

  it('every SQL seed slug has a TS mirror', () => {
    for (const slug of slugs) {
      expect(BUILT_IN_THEMES[slug]).toBeDefined();
    }
  });

  it('every theme has a complete colour palette', () => {
    for (const [slug, theme] of Object.entries(BUILT_IN_THEMES)) {
      const colors = theme.slideMaster.colors!;
      expect(colors.primary, `primary on ${slug}`).toBeDefined();
      expect(colors.background, `background on ${slug}`).toBeDefined();
      expect(colors.text, `text on ${slug}`).toBeDefined();
    }
  });
});

describe('InMemoryThemeStore', () => {
  it('returns each built-in theme by slug', async () => {
    const store = new InMemoryThemeStore();
    for (const slug of Object.keys(BUILT_IN_THEMES)) {
      const t = await store.findBySlug({ tenantId: 't1', slug });
      expect(t).not.toBeNull();
      expect(t!.slug).toBe(slug);
    }
  });

  it('accepts tenant overrides', async () => {
    const store = new InMemoryThemeStore();
    const custom = {
      ...BUILT_IN_THEMES['classic_corporate']!,
      id: 'custom_theme',
      tenantId: 't1',
      isBuiltIn: false,
    };
    store.registerTenantTheme(custom);
    const t = await store.findBySlug({
      tenantId: 't1',
      slug: 'classic_corporate',
    });
    expect(t!.id).toBe('custom_theme');
    // Other tenants still get the built-in.
    const t2 = await store.findBySlug({
      tenantId: 't2',
      slug: 'classic_corporate',
    });
    expect(t2!.id).toBe('theme_classic_corporate');
  });

  it('rejects registerTenantTheme without tenantId', () => {
    const store = new InMemoryThemeStore();
    expect(() =>
      store.registerTenantTheme({
        ...BUILT_IN_THEMES['classic_corporate']!,
        tenantId: null,
      }),
    ).toThrow(/tenantId/);
  });
});
