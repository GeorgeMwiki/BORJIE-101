/**
 * `routeArtifact` tests — the five-signal AND-gate (default inline,
 * bias-to-chat), the artifact-class → surface table, and unknown-kind
 * routing.
 */

import { describe, it, expect } from 'vitest';
import { routeArtifact } from '../route-artifact.js';
import { signals } from './fixtures.js';

describe('routeArtifact — the pure five-signal surface router', () => {
  // ── DEFAULT INLINE, bias-to-chat ──────────────────────────────────────
  it('defaults to inline when no signals fire', () => {
    const d = routeArtifact({ kind: 'data-table', signals: signals({}) });
    expect(d.surface).not.toBe('canvas');
    expect(d.surface).toMatch(/^inline-/);
  });

  it('a known but un-tabled kind stays inline-chip by default', () => {
    const d = routeArtifact({ kind: 'data-table', signals: signals({}) });
    expect(d.surface).toBe('inline-chip');
  });

  // ── the five-signal AND-gate ──────────────────────────────────────────
  it('graduates to canvas: substantial + selfContained + takeOutside', () => {
    const d = routeArtifact({
      kind: 'chart-vega',
      signals: signals({
        substantial: true,
        selfContained: true,
        takeOutside: true,
      }),
    });
    expect(d.surface).toBe('canvas');
    expect(d.promotable).toBe(false);
  });

  it('graduates to canvas: substantial + selfContained + reused', () => {
    const d = routeArtifact({
      kind: 'chart-vega',
      signals: signals({
        substantial: true,
        selfContained: true,
        reused: true,
      }),
    });
    expect(d.surface).toBe('canvas');
  });

  it('graduates to canvas: substantial + selfContained + editable', () => {
    const d = routeArtifact({
      kind: 'chart-vega',
      signals: signals({
        substantial: true,
        selfContained: true,
        editable: true,
      }),
    });
    expect(d.surface).toBe('canvas');
  });

  it('does NOT graduate when only substantial (no selfContained)', () => {
    const d = routeArtifact({
      kind: 'chart-vega',
      signals: signals({ substantial: true, takeOutside: true }),
    });
    expect(d.surface).not.toBe('canvas');
  });

  it('does NOT graduate when substantial + selfContained but no durability reason', () => {
    const d = routeArtifact({
      kind: 'chart-vega',
      signals: signals({ substantial: true, selfContained: true }),
    });
    expect(d.surface).not.toBe('canvas');
    // ...but it IS promotable via an explicit gesture.
    expect(d.promotable).toBe(true);
  });

  it('does NOT graduate a one-line affordance even when takeOutside+reused', () => {
    // not substantial → never earns canvas (bias-to-chat).
    const d = routeArtifact({
      kind: 'approval',
      signals: signals({ takeOutside: true, reused: true, editable: true }),
    });
    expect(d.surface).not.toBe('canvas');
  });

  // ── the artifact-class → surface table ────────────────────────────────
  it('routes action-class kinds to inline-action', () => {
    for (const kind of ['approval', 'prefill-form', 'signature-pad', 'slider-input']) {
      const d = routeArtifact({ kind, signals: signals({}) });
      expect(d.surface).toBe('inline-action');
    }
  });

  it('routes chip-class kinds to inline-chip', () => {
    for (const kind of ['kpi-grid', 'metric-sparkline', 'gauge', 'evidence-card']) {
      const d = routeArtifact({ kind, signals: signals({}) });
      expect(d.surface).toBe('inline-chip');
    }
  });

  it('routes text-class kinds to inline-text', () => {
    for (const kind of ['markdown-card', 'code-block', 'diff-view', 'decision-trace']) {
      const d = routeArtifact({ kind, signals: signals({}) });
      expect(d.surface).toBe('inline-text');
    }
  });

  // ── unknown-kind routing — the generativity guarantee (router half) ───
  it('routes an UNKNOWN kind to inline-text, never throws', () => {
    const d = routeArtifact({
      kind: 'geological-drill-core-viewer',
      signals: signals({}),
    });
    expect(d.surface).toBe('inline-text');
    expect(d.reason).toMatch(/unknown kind/i);
  });

  it('an UNKNOWN kind can STILL graduate to canvas when the gate passes', () => {
    // generativity is total: a never-seen kind is routed by signals like
    // any other, so a substantial+selfContained+durable unknown earns canvas.
    const d = routeArtifact({
      kind: 'geological-drill-core-viewer',
      signals: signals({
        substantial: true,
        selfContained: true,
        takeOutside: true,
      }),
    });
    expect(d.surface).toBe('canvas');
  });

  // ── forced-surface override (legible owner gesture) ───────────────────
  it('honours a forced surface (explicit owner gesture)', () => {
    const d = routeArtifact(
      { kind: 'kpi-grid', signals: signals({}) },
      { forcedSurface: 'canvas' },
    );
    expect(d.surface).toBe('canvas');
    expect(d.reason).toMatch(/forced/i);
  });

  // ── purity ────────────────────────────────────────────────────────────
  it('is pure — same input yields the same decision', () => {
    const input = {
      kind: 'chart-vega',
      signals: signals({ substantial: true, selfContained: true, reused: true }),
    };
    const a = routeArtifact(input);
    const b = routeArtifact(input);
    expect(a).toEqual(b);
  });

  it('echoes the signals it read back in the decision', () => {
    const s = signals({ substantial: true });
    const d = routeArtifact({ kind: 'kpi-grid', signals: s });
    expect(d.signals).toEqual(s);
  });
});
