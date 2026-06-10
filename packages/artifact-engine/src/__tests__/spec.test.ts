/**
 * `ArtifactSpec` schema tests — valid parses through, invalid is rejected,
 * the promoted binding + node tree behave, and an UNKNOWN kind is a VALID
 * spec (the parse-time half of the generativity guarantee).
 */

import { describe, it, expect } from 'vitest';
import {
  ArtifactSpecSchema,
  parseArtifactSpec,
  safeParseArtifactSpec,
  isKnownArtifactKind,
  kindRequiresEvidence,
  ARTIFACT_KIND_NAMES,
  ARTIFACT_INTERACTION_KINDS,
} from '../spec.js';
import { makeSpec, signals } from './fixtures.js';

describe('ArtifactSpec — the promoted PortalTabWidget over the 35-kind superset', () => {
  it('parses a valid spec for one of the 35 known kinds', () => {
    const spec = makeSpec({ kind: 'kpi-grid' });
    const parsed = parseArtifactSpec(spec);
    expect(parsed.kind).toBe('kpi-grid');
    expect(parsed.artifactId).toBe('artifact-fixture-1');
    expect(parsed.version).toBe(1);
  });

  it('carries the 5 new top-level fields', () => {
    const spec = makeSpec({
      lifecycle: 'iterating',
      signals: signals({ substantial: true, editable: true }),
      evidenceIds: ['ev-1', 'ev-2'],
      version: 3,
      artifactId: 'a:complex.1',
    });
    const parsed = parseArtifactSpec(spec);
    expect(parsed.lifecycle).toBe('iterating');
    expect(parsed.signals.substantial).toBe(true);
    expect(parsed.evidenceIds).toEqual(['ev-1', 'ev-2']);
    expect(parsed.version).toBe(3);
  });

  it('the kind enum mirrors the 35 PORTAL_DASHBOARD_KIND_NAMES', () => {
    expect(ARTIFACT_KIND_NAMES.length).toBe(35);
    for (const k of ARTIFACT_KIND_NAMES) {
      expect(isKnownArtifactKind(k)).toBe(true);
    }
  });

  // ── the generativity guarantee — parse-time half ──────────────────────
  it('an UNKNOWN / never-seen kind is still a VALID ArtifactSpec', () => {
    const spec = makeSpec({
      kind: 'geological-drill-core-viewer',
      config: { coreId: 'DDH-001' },
    });
    const parsed = safeParseArtifactSpec(spec);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('geological-drill-core-viewer');
    expect(isKnownArtifactKind('geological-drill-core-viewer')).toBe(false);
  });

  // ── the Auditor invariant — ≥1 evidence id is now STRUCTURAL ───────────
  it('a known DATA kind with an EMPTY evidence chain FAILS parse (Auditor invariant)', () => {
    const spec = makeSpec({ kind: 'chart-vega', evidenceIds: [] });
    const result = ArtifactSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      // The issue points squarely at evidenceIds so the brain knows what to fix.
      expect(result.error.issues.some((i) => i.path.includes('evidenceIds'))).toBe(
        true,
      );
    }
  });

  it('a known DATA kind with ≥1 evidence id PASSES parse', () => {
    const spec = makeSpec({ kind: 'chart-vega', evidenceIds: ['ev-9'] });
    const result = ArtifactSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('a known INTERACTION kind (approval) with an EMPTY evidence chain PASSES — an affordance cites nothing', () => {
    for (const kind of ARTIFACT_INTERACTION_KINDS) {
      const spec = makeSpec({ kind, config: null, evidenceIds: [] });
      const result = ArtifactSpecSchema.safeParse(spec);
      expect(result.success, `interaction kind '${kind}' must pass`).toBe(true);
    }
  });

  it('an UNKNOWN invented kind with an EMPTY evidence chain PASSES — generativity is never blocked for lacking evidence', () => {
    const spec = makeSpec({
      kind: 'geological-drill-core-viewer',
      config: { coreId: 'DDH-001' },
      evidenceIds: [],
    });
    const result = ArtifactSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
    expect(isKnownArtifactKind('geological-drill-core-viewer')).toBe(false);
    expect(kindRequiresEvidence('geological-drill-core-viewer')).toBe(false);
  });

  // ── strictness — no smuggled keys ─────────────────────────────────────
  it('rejects an unknown top-level key (.strict discipline preserved)', () => {
    const spec = { ...makeSpec(), injectedByLlm: 'gotcha' };
    const result = ArtifactSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
  });

  it('rejects a missing required field (artifactId)', () => {
    const spec = makeSpec();
    const { artifactId: _omit, ...withoutId } = spec;
    const result = ArtifactSpecSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects an empty/zero version', () => {
    const result = ArtifactSpecSchema.safeParse(makeSpec({ version: 0 }));
    expect(result.success).toBe(false);
  });

  // ── the promoted binding — vetted against the capability registry ─────
  it('accepts a query binding whose resource is in the registry', () => {
    const spec = makeSpec({
      kind: 'data-table',
      config: { columns: [], rows: [] },
      binding: { kind: 'query', resource: 'licences' },
    });
    expect(ArtifactSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('rejects a query binding whose resource is NOT in the registry', () => {
    const spec = makeSpec({
      binding: { kind: 'query', resource: 'definitely_not_a_resource' } as never,
    });
    expect(ArtifactSpecSchema.safeParse(spec).success).toBe(false);
  });

  it('accepts a tool binding whose toolId is in the registry', () => {
    const spec = makeSpec({
      binding: { kind: 'tool', toolId: 'create_reminder' },
    });
    expect(ArtifactSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('rejects a tool binding whose toolId is NOT in the registry', () => {
    const spec = makeSpec({
      binding: { kind: 'tool', toolId: 'launch_missiles' } as never,
    });
    expect(ArtifactSpecSchema.safeParse(spec).success).toBe(false);
  });

  // ── the addressable node tree ─────────────────────────────────────────
  it('accepts an optional node tree with unique nodeIds', () => {
    const spec = makeSpec({
      nodes: [
        {
          nodeId: 'root',
          kind: 'kpi-grid',
          config: null,
          children: [
            { nodeId: 'child-a', kind: 'gauge', config: null },
            { nodeId: 'child-b', kind: 'metric-sparkline', config: null },
          ],
        },
      ],
    });
    expect(ArtifactSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('rejects a node tree with duplicate nodeIds', () => {
    const spec = makeSpec({
      nodes: [
        { nodeId: 'dup', kind: 'gauge', config: null },
        { nodeId: 'dup', kind: 'gauge', config: null },
      ],
    });
    const result = ArtifactSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
  });

  it('safeParseArtifactSpec returns null on malformed input', () => {
    expect(safeParseArtifactSpec({ not: 'a spec' })).toBeNull();
    expect(safeParseArtifactSpec(null)).toBeNull();
  });
});
