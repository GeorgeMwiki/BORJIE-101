/**
 * Core memory blocks — service unit tests (D8).
 *
 * Verifies:
 *   - renderCoreMemoryBlocks returns empty string for empty input
 *   - rendered fragment contains the marker + every block kind
 *   - rendered fragment includes block text in order
 *
 * Drizzle-backed integration tests live in the test-db harness; here
 * we cover the pure renderer + the block-kind enum contract.
 */

import { describe, it, expect } from 'vitest';
import {
  renderCoreMemoryBlocks,
  type CoreMemoryBlock,
} from '../core-memory-blocks.service.js';

function block(
  kind: CoreMemoryBlock['blockKind'],
  text: string,
): CoreMemoryBlock {
  return {
    id: `${kind}-1`,
    tenantId: 'tn1',
    userId: 'u1',
    personaId: 'tenant-resident',
    blockKind: kind,
    blockText: text,
    metadata: {},
    createdAt: '2026-05-17T00:00:00Z',
    updatedAt: '2026-05-17T00:00:00Z',
    archivedAt: null,
  };
}

describe('renderCoreMemoryBlocks', () => {
  it('returns empty string for empty input', () => {
    expect(renderCoreMemoryBlocks([])).toBe('');
  });

  it('returns empty string for null-equivalent input', () => {
    expect(
      renderCoreMemoryBlocks(null as unknown as ReadonlyArray<CoreMemoryBlock>),
    ).toBe('');
  });

  it('includes the DO-NOT-OVERRIDE marker', () => {
    const out = renderCoreMemoryBlocks([
      block('persona', 'I am the resident concierge for John.'),
    ]);
    expect(out).toContain('[CORE MEMORY — DO NOT OVERRIDE]');
    expect(out).toContain('[END CORE MEMORY]');
  });

  it('renders multiple block kinds with headers', () => {
    const out = renderCoreMemoryBlocks([
      block('persona', 'Persona text'),
      block('human', 'Human text'),
      block('preferences', 'Pref text'),
      block('project', 'Project text'),
    ]);
    expect(out).toContain('### persona');
    expect(out).toContain('### human');
    expect(out).toContain('### preferences');
    expect(out).toContain('### project');
    expect(out).toContain('Persona text');
    expect(out).toContain('Project text');
  });

  it('preserves the order of input blocks', () => {
    const out = renderCoreMemoryBlocks([
      block('project', 'Project first'),
      block('persona', 'Persona second'),
    ]);
    const projectIdx = out.indexOf('Project first');
    const personaIdx = out.indexOf('Persona second');
    expect(projectIdx).toBeLessThan(personaIdx);
  });
});
