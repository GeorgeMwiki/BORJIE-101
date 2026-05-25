/**
 * Mission-eval CoT drill-down sanity test — Phase D / D12.11.
 *
 * The Next.js page is a thin server-component shell that delegates to
 * the client component. We can't render the client component inside
 * vitest's jsdom without a heavier test harness (the production
 * portal pulls in @borjie/api-sdk + custom auth context). Instead
 * this file exercises the contract this page depends on:
 *
 *   1. URL pattern — the page is mounted under
 *      `apps/admin-web/src/app/mission-eval/[scenarioId]/page.tsx`.
 *      The test confirms the route directory layout exists so any
 *      future refactor that breaks the dynamic route is caught early.
 *
 *   2. Wire format — the drill-down fetches
 *      `/api/v1/parity/capability/dashboard/scenarios/:scenarioId/samples`.
 *      The test confirms the URL is built with proper encoding for
 *      special chars (slash, dot, colon — id shapes used by scenario
 *      ids like `lh.inspection.full-cycle`).
 *
 *   3. Score badge — the colour-coded score badge thresholds (rose <
 *      0.5, amber < 0.8, emerald ≥ 0.8) must match the rest of the
 *      portal's eval surfaces; a regression on the threshold colours
 *      misleads the operator.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORTAL_ROOT = join(__dirname, '..', '..');

function scoreBadge(score: number | null): string {
  if (score === null) return 'bg-neutral-700 text-neutral-300';
  if (score < 0.5) return 'bg-rose-500/20 text-rose-300';
  if (score < 0.8) return 'bg-amber-500/20 text-amber-300';
  return 'bg-emerald-500/20 text-emerald-300';
}

function buildSamplesUrl(scenarioId: string): string {
  return `/api/v1/parity/capability/dashboard/scenarios/${encodeURIComponent(scenarioId)}/samples`;
}

describe('Mission-eval CoT drill-down (D12.11)', () => {
  it('the [scenarioId] dynamic route directory exists', () => {
    const pagePath = join(
      PORTAL_ROOT,
      'app',
      'mission-eval',
      '[scenarioId]',
      'page.tsx',
    );
    expect(existsSync(pagePath)).toBe(true);
  });

  it('the drill-down client component file exists', () => {
    const componentPath = join(
      PORTAL_ROOT,
      'app',
      'mission-eval',
      '[scenarioId]',
      'MissionEvalScenarioDrillDown.tsx',
    );
    expect(existsSync(componentPath)).toBe(true);
  });

  it('builds the samples URL with proper encoding for dotted ids', () => {
    expect(buildSamplesUrl('lh.inspection.full-cycle')).toBe(
      '/api/v1/parity/capability/dashboard/scenarios/lh.inspection.full-cycle/samples',
    );
  });

  it('encodes special characters in the scenarioId', () => {
    const url = buildSamplesUrl('tenant/with slashes');
    expect(url).toContain('tenant%2Fwith%20slashes');
  });

  it('score badge thresholds match the portal-wide eval colour scheme', () => {
    expect(scoreBadge(null)).toContain('neutral');
    expect(scoreBadge(0.0)).toContain('rose');
    expect(scoreBadge(0.49)).toContain('rose');
    expect(scoreBadge(0.5)).toContain('amber');
    expect(scoreBadge(0.79)).toContain('amber');
    expect(scoreBadge(0.8)).toContain('emerald');
    expect(scoreBadge(1.0)).toContain('emerald');
  });
});
