/**
 * artifact-egress-wiring — unit tests for the ARTIFACT egress membrane (OK-8a).
 *
 * Proves the SECURITY PROPERTY, not just the plumbing (INV-H / INV-D):
 *   - an artifact carrying a MECHANIC field (agent name / tool name / arbiter
 *     rationale / internal id / chain-of-thought) is STRIPPED before it reaches
 *     the client — at the top level AND smuggled inside a nested data blob;
 *   - a CLEAN artifact (renderable content + evidence_ids + status) renders
 *     INTACT — the membrane never mangles legitimate render fields;
 *   - FAIL-CLOSED: a structurally invalid part yields a safe-minimal artifact,
 *     NEVER the raw payload;
 *   - the envelope path projects the StatusSpan | Output | Evidence allow-list
 *     and drops a PortalTab's mechanic `audit` block + `sourceConversationId`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createArtifactEgressMembrane,
  getArtifactEgressMembrane,
  __setArtifactEgressMembraneForTests,
  type ArtifactEgressMembrane,
} from '../artifact-egress-wiring.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import type { AgUiUiPart } from '@borjie/genui/server';

function silentLogger(): PinoLikeLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Recursively collect every object key name in a value (for leak assertions). */
function allKeys(value: unknown, acc: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return acc;
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    acc.push(k);
    allKeys(v, acc);
  }
  return acc;
}

/** Serialize + assert a forbidden marker is nowhere in the projection. */
function expectNoMechanicTrace(value: unknown): void {
  const json = JSON.stringify(value).toLowerCase();
  expect(json).not.toContain('agentname');
  expect(json).not.toContain('agent_name');
  expect(json).not.toContain('toolname');
  expect(json).not.toContain('tool_name');
  expect(json).not.toContain('arbiter');
  expect(json).not.toContain('rationale');
  expect(json).not.toContain('chain_of_thought');
  expect(json).not.toContain('chainofthought');
}

describe('artifact-egress-wiring (OK-8a artifact membrane)', () => {
  it('STRIPS a top-level mechanic field from a ui-part', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    // A markdown-card with mechanic fields glued on by a buggy/hostile producer.
    const dirty = {
      kind: 'markdown-card',
      title: 'Royalty summary',
      markdown: '## Q2 royalties\nTZS 4.2M owed.',
      severity: 'info',
      agentName: 'fx-treasury-agent',
      toolName: 'mwikila.forecast.run',
      arbiterRationale: 'debate round 2 picked branch B',
      chainOfThought: 'first I considered... then...',
      __internalId: 'cog-7f3c',
    } as unknown as AgUiUiPart;

    const safe = membrane.guardUiPart(dirty);
    const keys = allKeys(safe);
    expect(keys).not.toContain('agentName');
    expect(keys).not.toContain('toolName');
    expect(keys).not.toContain('arbiterRationale');
    expect(keys).not.toContain('chainOfThought');
    expect(keys).not.toContain('__internalId');
    expectNoMechanicTrace(safe);
    // Renderable content survives.
    expect((safe as { markdown: string }).markdown).toContain('Q2 royalties');
    expect((safe as { title: string }).title).toBe('Royalty summary');
  });

  it('STRIPS a mechanic field SMUGGLED inside a heatmap CELL (deep scrub)', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    const dirty = {
      kind: 'heatmap',
      xAxis: ['Jan', 'Feb'],
      yAxis: ['Mine A', 'Mine B'],
      cells: [
        // a legit cell that ALSO carries mechanic keys a hostile/buggy producer glued on
        { x: 0, y: 0, value: 12, agentName: 'fx-treasury-agent', arbiter: 'debate branch B' },
        { x: 1, y: 1, value: 7 },
      ],
      colorScale: 'linear',
      format: 'count',
    } as unknown as AgUiUiPart;

    const safe = membrane.guardUiPart(dirty);
    expect(allKeys(safe)).not.toContain('agentName');
    expectNoMechanicTrace(safe);
    // Renderable cell data survives the scrub.
    expect(JSON.stringify(safe)).toContain('"value":12');
  });

  it('STRIPS a mechanic field SMUGGLED inside a nested data row', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    const dirty = {
      kind: 'data-table',
      title: 'Bids',
      columns: [{ id: 'price', header: 'Price', accessorKey: 'price' }],
      rows: [
        // a legit row that ALSO carries a mechanic key the producer leaked
        { price: 1200, agent_name: 'sales-offtake-agent', tool_call: { name: 'db.query' } },
      ],
    } as unknown as AgUiUiPart;

    const safe = membrane.guardUiPart(dirty) as { rows: Array<Record<string, unknown>> };
    expect(safe.rows[0]?.price).toBe(1200);
    expect(safe.rows[0]).not.toHaveProperty('agent_name');
    expect(safe.rows[0]).not.toHaveProperty('tool_call');
    expectNoMechanicTrace(safe);
  });

  it('DROPS a decision-trace step rationale (chain-of-thought) but keeps the scaffold', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    const dirty = {
      kind: 'decision-trace',
      title: 'Why I flagged this bid',
      summary: 'Counterparty risk above threshold.',
      steps: [
        {
          id: 's1',
          title: 'Observed counterparty',
          kind: 'observation',
          confidence: 'high',
          rationale: 'internal: debated whether the KYC score of 0.42 ...',
          evidence: [{ label: 'KYC-report', uri: 'ev://kyc/1' }],
        },
      ],
    } as unknown as AgUiUiPart;

    const safe = membrane.guardUiPart(dirty) as {
      steps: Array<Record<string, unknown>>;
    };
    expect(safe.steps[0]?.title).toBe('Observed counterparty');
    expect(safe.steps[0]?.kind).toBe('observation');
    expect(safe.steps[0]).not.toHaveProperty('rationale');
    // Evidence channel survives.
    expect(Array.isArray(safe.steps[0]?.evidence)).toBe(true);
    expectNoMechanicTrace(safe);
  });

  it('renders a CLEAN ui-part INTACT', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    const clean: AgUiUiPart = {
      kind: 'kpi-grid',
      title: 'Cashflow',
      tiles: [
        { label: 'Revenue', value: 4_200_000, format: 'currency', currency: 'TZS' },
        { label: 'Margin', value: 0.31, format: 'percent' },
      ],
    };
    const safe = membrane.guardUiPart(clean) as typeof clean;
    expect(safe).toEqual(clean);
  });

  it('FAILS CLOSED to a safe-minimal artifact on a structurally invalid part', () => {
    const logger = silentLogger();
    const membrane = createArtifactEgressMembrane(logger);
    // No `kind` discriminator → projectUiPart throws → fail-closed.
    const broken = { title: 'no kind here', markdown: 'x' } as unknown as AgUiUiPart;
    const safe = membrane.guardUiPart(broken);
    expect(safe.kind).toBe('notification-toast');
    expect((safe as { message: string }).message).toBe('Content unavailable.');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  // ── envelope (modality / Live re-query) path ──────────────────────────────

  it('projects the envelope allow-list and drops a tab audit block', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    const projected = membrane.guardEnvelope({
      status: 'done',
      evidenceIds: ['ev-1', 'ev-2', 42 as unknown as string],
      tab: {
        id: 'hr.payroll',
        tabKey: 'hr.payroll',
        title: 'Payroll',
        description: 'Track staff payroll',
        icon: 'users',
        domain: 'hr',
        sections: [{ key: 's1', title: 'People', widgets: [], fields: [] }],
        // mechanic header — must be dropped:
        audit: {
          createdBy: 'agent',
          history: [{ actor: 'agent', actorId: 'fx-treasury-agent' }],
          sourceConversationId: 'conv-7f3c',
        },
        permissions: { visibleToPersonas: ['owner'] },
      },
      artifact: {
        forecastRows: [{ month: '2026-07', value: 12 }],
        // smuggled mechanic key inside the forecast descriptor:
        arbiter: { winner: 'branch-B' },
      },
    });

    expect(projected.status).toBe('done');
    // Non-string evidence id dropped.
    expect(projected.evidenceIds).toEqual(['ev-1', 'ev-2']);
    // Tab render frame intact, audit dropped.
    const tab = projected.tab as Record<string, unknown>;
    expect(tab.title).toBe('Payroll');
    expect(tab).not.toHaveProperty('audit');
    expect(tab).not.toHaveProperty('permissions');
    // Artifact mechanic key scrubbed, renderable content intact.
    const artifact = projected.artifact as Record<string, unknown>;
    expect(artifact).not.toHaveProperty('arbiter');
    expect(Array.isArray(artifact.forecastRows)).toBe(true);
    expectNoMechanicTrace(projected);
  });

  it('envelope handles null artifact + tab without throwing', () => {
    const membrane = createArtifactEgressMembrane(silentLogger());
    const projected = membrane.guardEnvelope({ artifact: null, tab: null });
    expect(projected.artifact).toBeNull();
    expect(projected.tab).toBeNull();
    expect(projected.evidenceIds).toEqual([]);
    expect(projected.status).toBeNull();
  });

  it('singleton + test seam: getArtifactEgressMembrane is overridable', () => {
    const fake: ArtifactEgressMembrane = {
      guardUiPart: (p) => p,
      guardEnvelope: (i) => ({
        artifact: i.artifact ?? null,
        tab: i.tab ?? null,
        evidenceIds: [],
        status: null,
      }),
    };
    __setArtifactEgressMembraneForTests(fake);
    expect(getArtifactEgressMembrane()).toBe(fake);
    __setArtifactEgressMembraneForTests(null);
    // After reset a real membrane is built (fail-closed on broken part).
    const real = getArtifactEgressMembrane(silentLogger());
    expect(real.guardUiPart({} as unknown as AgUiUiPart).kind).toBe('notification-toast');
    __setArtifactEgressMembraneForTests(null);
  });
});
