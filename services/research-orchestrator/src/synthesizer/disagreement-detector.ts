/**
 * Disagreement detector — surfaces contradictions between sources.
 *
 * DEEP_RESEARCH_SPEC §4.4: "Disagreements are surfaced as a separate
 * disagreements[] array — never silently averaged."
 *
 * This module is a thin orchestrator-level wrapper around
 * `scorer/cross-reference.ts` that produces the exact shape the
 * ResearchResult expects. Kept separate so the synthesizer's
 * composition root stays small + the rendering layer has a clear
 * contract.
 *
 * @module research-orchestrator/synthesizer/disagreement-detector
 */

import type { ResearchArtifact } from '../types.js';
import { buildDisagreements, crossReference } from '../scorer/cross-reference.js';

export interface Disagreement {
  readonly topic: string;
  readonly sources: ReadonlyArray<string>;
}

/**
 * Build the disagreements array directly from a scored artifact set.
 * Empty array if no contradictions detected.
 */
export function detectDisagreements(
  artifacts: ReadonlyArray<ResearchArtifact>,
): ReadonlyArray<Disagreement> {
  const xref = crossReference(artifacts);
  return buildDisagreements(artifacts, xref);
}
