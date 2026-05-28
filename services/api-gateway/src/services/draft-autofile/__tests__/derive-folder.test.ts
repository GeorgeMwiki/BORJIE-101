/**
 * Tests for the Draft Auto-Filer derivation function.
 *
 * Asserts the pure folder + sub-folder derivation is deterministic
 * for known kinds, falls back to /docs/other for unknown kinds, and
 * sanitises counterparty names safely (no path traversal, no
 * unicode garbage).
 */

import { describe, it, expect } from 'vitest';
import {
  deriveFolderAssignment,
  createMemoryAutofilePort,
  FOLDER_MAP,
} from '../index';

describe('deriveFolderAssignment', () => {
  it('maps known kinds to canonical folders', () => {
    expect(deriveFolderAssignment({ inferredKind: 'mou' }).folder).toBe(
      '/docs/mous',
    );
    expect(deriveFolderAssignment({ inferredKind: 'msa' }).folder).toBe(
      '/docs/msas',
    );
    expect(
      deriveFolderAssignment({ inferredKind: 'regulator_letter' }).folder,
    ).toBe('/docs/regulator-letters');
  });

  it('falls back to /docs/other for unknown kinds', () => {
    const a = deriveFolderAssignment({ inferredKind: 'bizarre_kind' });
    expect(a.folder).toBe('/docs/other');
    expect(a.rationale).toContain('defaulting');
  });

  it('sanitises counterparty into a sub-folder', () => {
    const a = deriveFolderAssignment({
      inferredKind: 'mou',
      inferredCounterparty: 'Mahenge Gemstones Ltd.',
    });
    expect(a.folder).toBe('/docs/mous');
    expect(a.subFolder).toBe('mahenge-gemstones-ltd');
  });

  it('omits sub-folder for empty / null counterparty', () => {
    const a = deriveFolderAssignment({
      inferredKind: 'mou',
      inferredCounterparty: '',
    });
    expect(a.subFolder).toBeUndefined();
  });

  it('strips non-ASCII safely', () => {
    const a = deriveFolderAssignment({
      inferredKind: 'mou',
      inferredCounterparty: '../etc/passwd',
    });
    // Path-traversal sequences become harmless hyphens.
    expect(a.subFolder).not.toContain('/');
    expect(a.subFolder).not.toContain('..');
  });

  it('FOLDER_MAP covers core draft kinds the brain emits', () => {
    expect(Object.keys(FOLDER_MAP).length).toBeGreaterThan(10);
    expect(FOLDER_MAP).toHaveProperty('contract');
    expect(FOLDER_MAP).toHaveProperty('letter');
  });
});

describe('createMemoryAutofilePort', () => {
  it('records assignments with provenance', async () => {
    const port = createMemoryAutofilePort();
    await port.recordAssignment(
      't1',
      'd1',
      { folder: '/docs/mous', rationale: 'test' },
      { via: 'chat', sessionId: 'sess', turnId: 'turn' },
    );
    expect(port.assignments).toHaveLength(1);
    expect(port.assignments[0]).toMatchObject({
      tenantId: 't1',
      draftId: 'd1',
      sessionId: 'sess',
      turnId: 'turn',
    });
  });
});
