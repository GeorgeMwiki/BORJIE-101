/**
 * Mode registry — lookup table from `InterviewMode` to `ModeTemplate`.
 *
 * The five templates are immutable singletons; the registry is a
 * frozen lookup. Consumers obtain the template via
 * `getModeTemplate(mode)` rather than importing each module directly,
 * so the interview engine stays mode-agnostic.
 */

import type { InterviewMode } from '../types.js';
import { TacitKnowledgeError } from '../types.js';
import type { ModeTemplate } from './mode-shape.js';
import { walkTheFloorTemplate } from './walk-the-floor.js';
import { postIncidentTemplate } from './post-incident.js';
import { rideAlongTemplate } from './ride-along.js';
import { dealReplayTemplate } from './deal-replay.js';
import { crossRoleTemplate } from './cross-role.js';

const REGISTRY: Readonly<Record<InterviewMode, ModeTemplate>> = Object.freeze({
  'walk-the-floor': walkTheFloorTemplate,
  'post-incident': postIncidentTemplate,
  'ride-along': rideAlongTemplate,
  'deal-replay': dealReplayTemplate,
  'cross-role': crossRoleTemplate,
});

export function getModeTemplate(mode: InterviewMode): ModeTemplate {
  const template = REGISTRY[mode];
  if (template === undefined) {
    throw new TacitKnowledgeError(
      'TACIT_UNKNOWN_MODE',
      `Unknown interview mode: ${mode}`,
      { mode },
    );
  }
  return template;
}

export function listModeTemplates(): ReadonlyArray<ModeTemplate> {
  return Object.freeze([
    walkTheFloorTemplate,
    postIncidentTemplate,
    rideAlongTemplate,
    dealReplayTemplate,
    crossRoleTemplate,
  ]);
}
