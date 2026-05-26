/**
 * Mode templates — five frozen interview shapes.
 *
 * Each mode ships a question template, a pacing budget, a density
 * target, and the directives baked into the system prompt. These
 * tests verify the per-mode tuning required by
 * `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2.
 */

import { describe, expect, it } from 'vitest';
import {
  crossRoleTemplate,
  dealReplayTemplate,
  getModeTemplate,
  INTERVIEW_MODES,
  listModeTemplates,
  postIncidentTemplate,
  rideAlongTemplate,
  TacitKnowledgeError,
  walkTheFloorTemplate,
} from '../index.js';

describe('mode templates', () => {
  it('walk-the-floor caps Mr. Mwikila at 2 questions in a row with a tight word budget', () => {
    expect(walkTheFloorTemplate.mode).toBe('walk-the-floor');
    expect(walkTheFloorTemplate.pacing.maxQuestionsInARow).toBe(2);
    expect(walkTheFloorTemplate.pacing.maxWordsPerUtterance).toBeLessThanOrEqual(25);
    expect(walkTheFloorTemplate.pacing.speechRatioTarget).toBeGreaterThanOrEqual(5);
    expect(walkTheFloorTemplate.questions.length).toBeGreaterThan(3);
    // Directives must include the voice-first cue.
    expect(
      walkTheFloorTemplate.directives.some((d) => /voice/i.test(d)),
    ).toBe(true);
  });

  it('post-incident enforces blame-free + long dwell silence', () => {
    expect(postIncidentTemplate.mode).toBe('post-incident');
    expect(postIncidentTemplate.pacing.maxQuestionsInARow).toBe(1);
    expect(postIncidentTemplate.pacing.postSubjectDwellMs).toBeGreaterThanOrEqual(2000);
    expect(
      postIncidentTemplate.directives.some((d) => /blame-free/i.test(d)),
    ).toBe(true);
    // Density bound covers the spec's 15-40 expected range.
    expect(postIncidentTemplate.density.min).toBe(15);
    expect(postIncidentTemplate.density.max).toBe(40);
  });

  it('ride-along surfaces GPS-tagged route knowledge with seasonal awareness', () => {
    expect(rideAlongTemplate.mode).toBe('ride-along');
    // Must include a seasonal / time-of-year prompt.
    expect(
      rideAlongTemplate.questions.some((q) => /time of year|season/i.test(q)),
    ).toBe(true);
    // Must include a routing-conditional prompt.
    expect(
      rideAlongTemplate.questions.some((q) =>
        /convoy|police|weighbridge/i.test(q),
      ),
    ).toBe(true);
    expect(
      rideAlongTemplate.directives.some((d) => /gps|tag/i.test(d)),
    ).toBe(true);
  });

  it('deal-replay allows 3 questions in a row and asks for paralinguistic cues', () => {
    expect(dealReplayTemplate.mode).toBe('deal-replay');
    expect(dealReplayTemplate.pacing.maxQuestionsInARow).toBe(3);
    expect(
      dealReplayTemplate.questions.some((q) =>
        /read in the way|paralinguistic|pause/i.test(q),
      ),
    ).toBe(true);
    expect(dealReplayTemplate.pacing.speechRatioTarget).toBeLessThan(
      walkTheFloorTemplate.pacing.speechRatioTarget,
    );
  });

  it('cross-role uses silent-observer pacing — almost no Mr. Mwikila speech', () => {
    expect(crossRoleTemplate.mode).toBe('cross-role');
    expect(crossRoleTemplate.pacing.maxQuestionsInARow).toBe(1);
    expect(crossRoleTemplate.pacing.speechRatioTarget).toBeGreaterThanOrEqual(10);
    expect(
      crossRoleTemplate.directives.some((d) => /silent observer/i.test(d)),
    ).toBe(true);
  });

  it('mode registry yields a template for every mode + throws on unknown', () => {
    INTERVIEW_MODES.forEach((mode) => {
      const t = getModeTemplate(mode);
      expect(t.mode).toBe(mode);
    });
    expect(listModeTemplates().length).toBe(5);
    expect(() => getModeTemplate('walk-the-pit' as unknown as 'walk-the-floor')).toThrow(
      TacitKnowledgeError,
    );
  });
});
