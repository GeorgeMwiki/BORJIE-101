/**
 * Body-schema reader — bridges @borjie/system-graph to the kernel's
 * dynamic self-awareness. Proves the static BRAIN_MODULES drift is killed:
 * the rendered block reflects the live derived body, not a hand list.
 */

import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  attachHealth,
  type SystemGraph,
  type NodeCandidate,
} from '@borjie/system-graph';
import {
  createBodySchemaReader,
  bodySchemaReaderFromGraph,
  queryBodySchemaTool,
  bodyBlastRadiusTool,
} from '../body-schema-reader.js';
import {
  renderSelfAwarenessBlock,
  describeSelf,
  renderModuleInventoryBlock,
} from '../../self-awareness.js';

function fixtureGraph(): SystemGraph {
  const nodes: NodeCandidate[] = [
    { id: 'org:borjie', kind: 'org', label: 'Borjie', derivedFrom: 'self' },
    { id: 'surface:owner-web', kind: 'surface', label: 'owner-web', derivedFrom: 'screens' },
    { id: 'capability:offtake', kind: 'capability', label: 'Offtake', derivedFrom: 'capabilities' },
    { id: 'junior:metallurgy', kind: 'junior', label: 'Metallurgy', derivedFrom: 'juniors' },
  ];
  return buildGraph({ nodes, edges: [], derivedAt: '2026-06-08T00:00:00.000Z' });
}

describe('createBodySchemaReader', () => {
  it('returns null before the first derivation', () => {
    const reader = createBodySchemaReader(() => null);
    expect(reader()).toBeNull();
  });

  it('renders a live organ-map snapshot from the graph', () => {
    const reader = bodySchemaReaderFromGraph(fixtureGraph());
    const snap = reader();
    expect(snap).not.toBeNull();
    expect(snap!.inventoryBlock).toMatch(/Live body schema/);
    expect(snap!.revision).toHaveLength(64);
  });

  it('reflects a hot-swapped graph (listChanged refresh)', () => {
    let graph: SystemGraph | null = null;
    const reader = createBodySchemaReader(() => graph);
    expect(reader()).toBeNull();
    graph = fixtureGraph();
    expect(reader()!.inventoryBlock).toMatch(/Surfaces \(apps \+ portals\): 1/);
  });
});

describe('renderSelfAwarenessBlock (dynamic path)', () => {
  it('prefers the live derived block when a reader is wired', () => {
    const reader = bodySchemaReaderFromGraph(fixtureGraph());
    const block = renderSelfAwarenessBlock(reader);
    expect(block).toMatch(/Live body schema/);
    // The static module list does NOT have this dynamic header.
    expect(block).not.toBe(renderModuleInventoryBlock());
  });

  it('falls back to the static block when no reader is wired', () => {
    expect(renderSelfAwarenessBlock()).toBe(renderModuleInventoryBlock());
    expect(renderSelfAwarenessBlock(null)).toBe(renderModuleInventoryBlock());
  });

  it('falls back to static when the reader returns null', () => {
    const reader = createBodySchemaReader(() => null);
    expect(renderSelfAwarenessBlock(reader)).toBe(renderModuleInventoryBlock());
  });

  it('is fail-safe — a throwing reader falls back, never crashes', () => {
    const reader = () => {
      throw new Error('boom');
    };
    expect(renderSelfAwarenessBlock(reader)).toBe(renderModuleInventoryBlock());
  });

  it('still opens with the [BRAIN SELF-AWARENESS] sentinel (contract kept)', () => {
    const reader = bodySchemaReaderFromGraph(fixtureGraph());
    expect(renderSelfAwarenessBlock(reader).startsWith('[BRAIN SELF-AWARENESS]')).toBe(true);
  });
});

describe('describeSelf', () => {
  it('grounds the answer in the live body when wired', () => {
    const reader = bodySchemaReaderFromGraph(fixtureGraph());
    expect(describeSelf(reader)).toMatch(/live, derived self-model/);
  });

  it('falls back to the static description otherwise', () => {
    expect(describeSelf()).toMatch(/I am the Borjie brain/);
  });
});

describe('queryBodySchemaTool (MemGPT page-in)', () => {
  it('returns null before derivation', () => {
    expect(queryBodySchemaTool(() => null)).toBeNull();
  });

  it('pages in filtered organs on demand', () => {
    const graph = fixtureGraph();
    const page = queryBodySchemaTool(() => graph, { kind: 'capability' });
    expect(page).not.toBeNull();
    expect(page!.nodes.every((n) => n.kind === 'capability')).toBe(true);
  });
});

describe('bodyBlastRadiusTool (injured-limb traversal)', () => {
  it('returns null before derivation', () => {
    expect(bodyBlastRadiusTool(() => null, 'capability:offtake')).toBeNull();
  });

  it('finds dependents of an injured organ', () => {
    const base = buildGraph({
      nodes: [
        { id: 'capability:a', kind: 'capability', label: 'A', derivedFrom: 't' },
        { id: 'capability:b', kind: 'capability', label: 'B', derivedFrom: 't' },
      ],
      edges: [{ srcId: 'capability:b', dstId: 'capability:a', edgeType: 'depends_on' }],
      derivedAt: '2026-06-08T00:00:00.000Z',
    });
    const injured = attachHealth(base, [
      {
        nodeId: 'capability:a',
        health: { state: 'injured', competence: 0, calibrationError: 1, source: 'otel' },
      },
    ]);
    const radius = bodyBlastRadiusTool(() => injured, 'capability:a');
    expect(radius).toContain('capability:b');
  });
});
