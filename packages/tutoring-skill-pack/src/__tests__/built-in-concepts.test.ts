/**
 * Built-in concepts parity test — TS mirror ⇔ migration 0210 seed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  BUILT_IN_CONCEPTS,
  InMemoryConceptStore,
  tutorActionId,
  makeMasteryRecorder,
} from '../index.js';

const here = dirname(fileURLToPath(import.meta.url));
// Migration was moved to `.archive/migrations/` during the wave 10E
// mechanical cleanup — it's still the canonical source for the seed
// slugs we mirror in BUILT_IN_CONCEPTS.
const MIGRATION_PATH = join(
  here,
  '..',
  '..',
  '..',
  'database',
  '.archive',
  'migrations',
  '0210_tutoring_skill_pack.sql',
);

function extractSlugs(): string[] {
  const sql = readFileSync(MIGRATION_PATH, 'utf-8');
  const matches = Array.from(sql.matchAll(/'skill_([a-z0-9_]+)',/g)).map(
    (m) => m[1]!,
  );
  // Dedupe.
  return [...new Set(matches)];
}

describe('BUILT_IN_CONCEPTS ↔ migration 0210', () => {
  const slugs = extractSlugs();

  it('migration seeds 10 distinct concept ids', () => {
    expect(slugs.length).toBe(10);
  });

  it('every BUILT_IN_CONCEPTS slug is present in the seed', () => {
    for (const slug of Object.keys(BUILT_IN_CONCEPTS)) {
      expect(slugs).toContain(slug);
    }
  });

  it('every seed slug has a TS-mirror entry', () => {
    for (const slug of slugs) {
      expect(BUILT_IN_CONCEPTS[slug]).toBeDefined();
    }
  });

  it('every concept has non-empty content', () => {
    for (const [slug, concept] of Object.entries(BUILT_IN_CONCEPTS)) {
      expect(concept.content.hook.length, `hook on ${slug}`).toBeGreaterThan(
        0,
      );
      expect(
        concept.content.definition.length,
        `definition on ${slug}`,
      ).toBeGreaterThan(0);
      expect(
        concept.content.check_understanding.length,
        `checks on ${slug}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('InMemoryConceptStore returns each concept by slug', async () => {
    const store = new InMemoryConceptStore();
    for (const slug of Object.keys(BUILT_IN_CONCEPTS)) {
      const c = await store.findBySlug({
        tenantId: 'tenant-1',
        conceptSlug: slug,
      });
      expect(c).not.toBeNull();
      expect(c!.conceptSlug).toBe(slug);
    }
  });

  it('listPlatformSlugs returns 10', () => {
    const store = new InMemoryConceptStore();
    expect(store.listPlatformSlugs()).toHaveLength(10);
  });
});

describe('makeMasteryRecorder', () => {
  it('flushes one user action per record call', async () => {
    const events: Array<{
      tenantId: string;
      userId: string;
      actionId: string;
    }> = [];
    const recorder = makeMasteryRecorder(async (e) => {
      events.push(e);
    });
    await recorder.record({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
      outcome: 'correct',
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.actionId).toBe(
      tutorActionId('net_operating_income', 'correct'),
    );
  });
});
