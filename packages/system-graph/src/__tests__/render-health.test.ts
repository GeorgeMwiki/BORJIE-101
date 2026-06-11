import { describe, it, expect } from 'vitest';
import { buildGraph } from '../builder.js';
import { summariseOrganMap } from '../query.js';
import { renderOrganMapBlock, describeBody } from '../render.js';
import { attachHealth } from '../health.js';
import type { NodeCandidate, SystemGraph } from '../types.js';

function graph(nodes: NodeCandidate[]): SystemGraph {
  return buildGraph({ nodes, edges: [], derivedAt: '2026-06-08T00:00:00.000Z' });
}

const BASE: NodeCandidate[] = [
  { id: 'org:borjie', kind: 'org', label: 'Borjie', derivedFrom: 'self' },
  { id: 'surface:owner-web', kind: 'surface', label: 'owner-web', derivedFrom: 'screens' },
  { id: 'capability:offtake', kind: 'capability', label: 'Offtake', derivedFrom: 'capabilities' },
  { id: 'junior:metallurgy', kind: 'junior', label: 'Metallurgy', derivedFrom: 'juniors' },
];

describe('renderOrganMapBlock', () => {
  it('opens + closes with the sentinel block (backward-compatible)', () => {
    const block = renderOrganMapBlock(summariseOrganMap(graph(BASE)));
    expect(block.startsWith('[BRAIN SELF-AWARENESS]')).toBe(true);
    expect(block.endsWith('[END BRAIN SELF-AWARENESS]')).toBe(true);
  });

  it('renders organ counts and the HOW TO USE guidance', () => {
    const block = renderOrganMapBlock(summariseOrganMap(graph(BASE)));
    expect(block).toMatch(/Live body schema/);
    expect(block).toMatch(/Surfaces \(apps \+ portals\): 1/);
    expect(block).toMatch(/HOW TO USE THIS SELF-KNOWLEDGE/);
    expect(block).toMatch(/query_body_schema/);
  });

  it('flags injured limbs', () => {
    const injured = attachHealth(graph(BASE), [
      {
        nodeId: 'capability:offtake',
        health: { state: 'injured', competence: 0, calibrationError: 1, source: 'otel' },
      },
    ]);
    const block = renderOrganMapBlock(summariseOrganMap(injured));
    expect(block).toMatch(/INJURED LIMBS/);
    expect(block).toContain('capability:offtake');
  });
});

describe('describeBody', () => {
  it('grounds the answer in the live body counts', () => {
    const out = describeBody(summariseOrganMap(graph(BASE)));
    expect(out).toMatch(/I am the Borjie brain/);
    expect(out).toMatch(/1 surfaces/);
    expect(out).toMatch(/I AM the platform/);
  });
});

describe('attachHealth', () => {
  it('attaches health and recomputes the revision (listChanged)', () => {
    const g = graph(BASE);
    const enriched = attachHealth(g, [
      {
        nodeId: 'capability:offtake',
        health: { state: 'degraded', competence: 0.3, calibrationError: 0.2, source: 'otel' },
      },
    ]);
    expect(enriched.revision).not.toBe(g.revision);
    const target = enriched.nodes.find((n) => n.id === 'capability:offtake');
    expect(target!.health?.state).toBe('degraded');
  });

  it('ignores readings for unknown nodes', () => {
    const g = graph(BASE);
    const enriched = attachHealth(g, [
      {
        nodeId: 'capability:ghost',
        health: { state: 'injured', competence: 0, calibrationError: 1, source: 'otel' },
      },
    ]);
    expect(enriched.revision).toBe(g.revision);
  });

  it('is a no-op for empty readings (immutable, same ref)', () => {
    const g = graph(BASE);
    expect(attachHealth(g, [])).toBe(g);
  });

  it('does not mutate the input graph', () => {
    const g = graph(BASE);
    const before = JSON.stringify(g);
    attachHealth(g, [
      {
        nodeId: 'capability:offtake',
        health: { state: 'injured', competence: 0, calibrationError: 1, source: 'otel' },
      },
    ]);
    expect(JSON.stringify(g)).toBe(before);
  });
});
