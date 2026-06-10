/**
 * Shared test fixtures — a valid `ArtifactSpec` builder + signal presets.
 *
 * Keeps the test files terse and the "what is a valid spec" knowledge in
 * one place so a schema change ripples through one fixture, not 20 inline
 * literals.
 */

import type { ArtifactSignals, ArtifactSpec } from '../spec.js';

/** All-false signals — the most conservative routing input (stays inline). */
export const NO_SIGNALS: ArtifactSignals = {
  substantial: false,
  editable: false,
  selfContained: false,
  takeOutside: false,
  reused: false,
};

/** Build a signals object, defaulting every key to false. */
export function signals(partial: Partial<ArtifactSignals>): ArtifactSignals {
  return { ...NO_SIGNALS, ...partial };
}

/**
 * Build a valid `ArtifactSpec` for a given kind, with overridable fields.
 * Defaults to a `kpi-grid` (a real one of the 35) carrying a minimal valid
 * config so the renderer path is exercisable too.
 *
 * NOTE: the default carries ONE `evidenceIds` entry because the default
 * kind (`kpi-grid`) is a DATA surface, and the spec's superRefine now makes
 * the Auditor "≥1 evidence id per recommendation" invariant structural — a
 * data/recommendation kind with an empty chain fails parse. Tests that
 * exercise the empty-chain paths (interaction kinds, unknown kinds, or the
 * evidence gate itself) override `evidenceIds` explicitly.
 */
export function makeSpec(overrides: Partial<ArtifactSpec> = {}): ArtifactSpec {
  return {
    key: 'fixture-widget',
    kind: 'kpi-grid',
    title: 'Fixture Artifact',
    config: {
      tiles: [
        { label: 'Output', value: 42, format: 'number' as const },
      ],
    },
    artifactId: 'artifact-fixture-1',
    lifecycle: 'ephemeral',
    signals: NO_SIGNALS,
    evidenceIds: ['ev-fixture-1'],
    version: 1,
    ...overrides,
  } as ArtifactSpec;
}
