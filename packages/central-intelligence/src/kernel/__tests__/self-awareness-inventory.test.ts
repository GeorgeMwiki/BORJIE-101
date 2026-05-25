/**
 * Self-awareness — module inventory tests.
 *
 * The drift-gate side of self-awareness is covered by
 * `kernel-units.test.ts` and the pre-existing pipeline tests. This
 * file targets the new module-inventory injector that closes the
 * top-1 LITFIN gap.
 */

import { describe, it, expect } from 'vitest';
import {
  BRAIN_MODULES,
  groupByCategory,
  renderModuleInventoryBlock,
  describeCapabilities,
  type BrainModuleCategory,
} from '../self-awareness.js';

describe('BRAIN_MODULES', () => {
  it('enumerates at least 27 modules', () => {
    expect(BRAIN_MODULES.length).toBeGreaterThanOrEqual(27);
  });

  it('every module has id / name / category / oneLiner', () => {
    for (const m of BRAIN_MODULES) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.category).toBeTruthy();
      expect(m.oneLiner.length).toBeGreaterThan(20);
    }
  });

  it('module ids are unique', () => {
    const ids = BRAIN_MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses all 8 categories', () => {
    const cats = new Set(BRAIN_MODULES.map((m) => m.category));
    const expected: BrainModuleCategory[] = [
      'memory', 'identity', 'sensing', 'reasoning',
      'policy', 'output', 'audit', 'agency',
    ];
    for (const c of expected) {
      expect(cats.has(c)).toBe(true);
    }
  });

  it('advertises property-management capabilities', () => {
    const ids = new Set(BRAIN_MODULES.map((m) => m.id));
    expect(ids.has('rent-reconciliation')).toBe(true);
    expect(ids.has('kra-mri-compute')).toBe(true);
    expect(ids.has('market-rate')).toBe(true);
    expect(ids.has('maintenance-triage')).toBe(true);
  });

  it('advertises persona-drift probes', () => {
    const ids = new Set(BRAIN_MODULES.map((m) => m.id));
    expect(ids.has('persona-drift-probe')).toBe(true);
    expect(ids.has('tool-loop-drift')).toBe(true);
  });
});

describe('groupByCategory', () => {
  it('partitions modules by category', () => {
    const grouped = groupByCategory();
    let total = 0;
    for (const list of grouped.values()) {
      total += list.length;
    }
    expect(total).toBe(BRAIN_MODULES.length);
  });

  it('each group contains only its category', () => {
    const grouped = groupByCategory();
    for (const [cat, list] of grouped) {
      for (const m of list) {
        expect(m.category).toBe(cat);
      }
    }
  });
});

describe('renderModuleInventoryBlock', () => {
  it('opens with the sentinel and closes with the terminator', () => {
    const block = renderModuleInventoryBlock();
    expect(block.startsWith('[BRAIN SELF-AWARENESS]')).toBe(true);
    expect(block.endsWith('[END BRAIN SELF-AWARENESS]')).toBe(true);
  });

  it('includes every category label', () => {
    const block = renderModuleInventoryBlock();
    expect(block).toMatch(/Memory:/);
    expect(block).toMatch(/Identity:/);
    expect(block).toMatch(/Sensing:/);
    expect(block).toMatch(/Reasoning:/);
    expect(block).toMatch(/Policy:/);
    expect(block).toMatch(/Output:/);
    expect(block).toMatch(/Audit:/);
    expect(block).toMatch(/Agency:/);
  });

  it('includes the HOW TO USE guidance block', () => {
    const block = renderModuleInventoryBlock();
    expect(block).toMatch(/HOW TO USE THIS SELF-KNOWLEDGE/);
    expect(block).toMatch(/what can you do/);
  });

  it('renders every module name', () => {
    const block = renderModuleInventoryBlock();
    for (const m of BRAIN_MODULES) {
      expect(block).toContain(m.name);
    }
  });

  it('cites property-management capabilities verbatim', () => {
    const block = renderModuleInventoryBlock();
    expect(block).toMatch(/Rent reconciliation/);
    expect(block).toMatch(/KRA \+ MRI compute/);
    expect(block).toMatch(/Market-rate surveillance/);
    expect(block).toMatch(/Maintenance triage/);
  });
});

describe('describeCapabilities', () => {
  it('produces a single-paragraph user-facing answer', () => {
    const out = describeCapabilities();
    expect(out).toMatch(/I am the Borjie brain/);
    expect(out).toMatch(/property-management/);
    expect(out).toMatch(/rent reconciliation/);
    expect(out).toMatch(/I AM the platform/);
  });

  it('references the total module count', () => {
    const out = describeCapabilities();
    expect(out).toContain(String(BRAIN_MODULES.length));
  });
});
