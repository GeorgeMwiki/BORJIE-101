/**
 * Tests for the entity extractor — canonicalisation + port
 * orchestration. The LLM is mocked.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicaliseEntities,
  extractEntities,
} from '../extraction/entity-extractor.js';
import type {
  EntityExtractorPort,
  ExtractedEntity,
} from '../types.js';

function mockPort(raw: ReadonlyArray<ExtractedEntity>): EntityExtractorPort {
  return {
    async extract() {
      return raw;
    },
  };
}

describe('canonicaliseEntities', () => {
  it('de-duplicates case-insensitive matches, keeping longest description', () => {
    const out = canonicaliseEntities([
      { name: 'Geita', type: 'place', description: 'short' },
      { name: 'GEITA', type: 'place', description: 'longer description wins' },
      { name: '  geita  ', type: 'place', description: 'mid' },
    ]);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.description).toBe('longer description wins');
  });

  it('drops empty names', () => {
    const out = canonicaliseEntities([
      { name: '   ', type: 'concept', description: 'x' },
      { name: 'Real', type: 'concept', description: 'y' },
    ]);
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.name).toBe('Real');
  });

  it('returns entities sorted alphabetically (stable)', () => {
    const out = canonicaliseEntities([
      { name: 'Zulu', type: 'person', description: 'a' },
      { name: 'Alpha', type: 'person', description: 'b' },
      { name: 'Mike', type: 'person', description: 'c' },
    ]);
    expect(out.entities.map((e) => e.name)).toEqual(['Alpha', 'Mike', 'Zulu']);
  });
});

describe('extractEntities', () => {
  it('returns empty array for empty text without calling the port', async () => {
    let called = false;
    const port: EntityExtractorPort = {
      async extract() {
        called = true;
        return [];
      },
    };
    const out = await extractEntities({ port, text: '   ' });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });

  it('canonicalises the port output', async () => {
    const port = mockPort([
      { name: 'Mr. Mwikila', type: 'person', description: 'agent' },
      { name: 'mr. mwikila', type: 'person', description: 'agent (long)' },
    ]);
    const out = await extractEntities({ port, text: 'some text' });
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe('agent (long)');
  });

  it('passes the original text through to the port', async () => {
    let seenText = '';
    const port: EntityExtractorPort = {
      async extract(text) {
        seenText = text;
        return [];
      },
    };
    await extractEntities({ port, text: 'corpus chunk' });
    expect(seenText).toBe('corpus chunk');
  });
});
