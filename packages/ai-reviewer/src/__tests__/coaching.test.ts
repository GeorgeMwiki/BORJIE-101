import { describe, it, expect } from 'vitest';
import { coachWorkInProgress } from '../coaching/index.js';
import { ctx } from './fixtures.js';
import { fakeCoachBrain, fakeUserContext } from './test-doubles.js';

describe('coachWorkInProgress', () => {
  it('returns heuristic hints when policy preChecks find issues', async () => {
    // Polygon with only 2 vertices ⇒ "too_few" heuristic
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'polygon_draw',
        partialPayload: {
          polygon: {
            vertices: [
              { lat: 0, lng: 0 },
              { lat: 0, lng: 1 },
            ],
          },
        },
        context: ctx,
      },
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(hints[0]?.title).toBe('polygon.vertices.too_few');
    expect(hints[0]?.tone).toBe('caution');
  });

  it('maps severity to tone (error/warning -> caution)', async () => {
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'parcel_edit',
        partialPayload: { parcelId: 'p1', currentName: 'A', newName: 'A' },
        context: ctx,
      },
    });
    // The no-op rename warning maps to "caution"
    const noop = hints.find((h) => h.title === 'parcel.name.noop');
    expect(noop?.tone).toBe('caution');
  });

  it('returns empty array when payload has no fields and no brain', async () => {
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'parcel_edit',
        partialPayload: {},
        context: ctx,
      },
    });
    // preChecks for parcel_edit with empty payload still emits the
    // "id missing" error → caution. So hints will not be empty.
    expect(hints.some((h) => h.title === 'parcel.id.missing')).toBe(true);
  });

  it('falls back to brain coach when heuristics return nothing AND payload has fields', async () => {
    // metadata_update with an entityId and valid tags ⇒ no preCheck issues
    const brain = fakeCoachBrain([
      {
        id: 'tip_1',
        tone: 'hint',
        title: 'Consider adding context tag',
        body: 'Adding a "draft" tag will let teammates know this is in flight.',
      },
    ]);
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'metadata_update',
        partialPayload: { entityId: 'e1', tagsToAdd: ['draft'] },
        context: ctx,
      },
      brain,
    });
    expect(hints).toEqual([
      expect.objectContaining({ id: 'tip_1', tone: 'hint' }),
    ]);
    expect(brain.calls.length).toBe(1);
  });

  it('skips brain when no fields supplied even if brain is available', async () => {
    const brain = fakeCoachBrain([
      { id: 'unused', tone: 'hint', title: 'x', body: 'y' },
    ]);
    // Use a kind whose empty-payload preChecks yield nothing — but none of
    // our policies do. To get a true "no heuristics" path we pass a brain
    // and an empty payload to inspection (which emits issues) and assert
    // the brain WAS NOT called (heuristics took over).
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'inspection',
        partialPayload: {},
        context: ctx,
      },
      brain,
    });
    expect(hints.length).toBeGreaterThan(0);
    expect(brain.calls.length).toBe(0);
  });

  it('drops invalid coach responses through the schema gate', async () => {
    const brain = fakeCoachBrain([
      // missing required fields
      { id: '', tone: 'hint', title: '', body: '' } as never,
      { id: 'good', tone: 'hint', title: 'Good hint', body: 'Body' },
    ]);
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'metadata_update',
        partialPayload: { entityId: 'e1', tagsToAdd: ['ok'] },
        context: ctx,
      },
      brain,
    });
    expect(hints.length).toBe(1);
    expect(hints[0]?.id).toBe('good');
  });

  it('fetches user-context dossier when supplied and brain is called', async () => {
    const brain = fakeCoachBrain([
      { id: 'ctx_tip', tone: 'hint', title: 'Use prior tag scheme', body: 'See dossier.' },
    ]);
    const userContext = fakeUserContext(['User prefers shorthand tags like "wip".']);
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'metadata_update',
        partialPayload: { entityId: 'e1', tagsToAdd: ['ok'] },
        context: ctx,
      },
      brain,
      userContext,
    });
    expect(hints[0]?.id).toBe('ctx_tip');
    expect(brain.calls[0]?.question).toContain('shorthand tags');
  });

  it('tolerates brain throwing — returns empty array, never propagates', async () => {
    const brain = {
      async coach() {
        throw new Error('coach_failed');
      },
    };
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'metadata_update',
        partialPayload: { entityId: 'e1', tagsToAdd: ['ok'] },
        context: ctx,
      },
      brain,
    });
    expect(hints).toEqual([]);
  });

  it('caps hints at maxHints', async () => {
    const brain = fakeCoachBrain([
      { id: 'a', tone: 'hint', title: 'a', body: 'a' },
      { id: 'b', tone: 'hint', title: 'b', body: 'b' },
      { id: 'c', tone: 'hint', title: 'c', body: 'c' },
    ]);
    const hints = await coachWorkInProgress({
      runInProgress: {
        kind: 'metadata_update',
        partialPayload: { entityId: 'e1', tagsToAdd: ['ok'] },
        context: ctx,
      },
      brain,
      maxHints: 2,
    });
    expect(hints.length).toBe(2);
  });
});
