/**
 * Interview engine — orchestration tests.
 *
 * Covers:
 *   - happy path: start → 2 turns → extraction persisted → complete.
 *   - consent missing at start blocks the session.
 *   - consent revoked mid-session blocks further persistence.
 *   - redundancy detection routes to reinforce instead of observe.
 */

import { describe, expect, it } from 'vitest';
import {
  createCellWriter,
  createConsentManager,
  createInMemoryCognitiveMemorySink,
  createInMemoryTacitConsentRepository,
  createInMemoryTacitExtractionRepository,
  createInMemoryTacitInterviewRepository,
  createInMemoryVectorIndex,
  createInterviewEngine,
  createRedundancyChecker,
  createReferenceEntityExtractor,
  TacitKnowledgeError,
} from '../index.js';

function fixedClock(startIso: string): () => Date {
  let ms = new Date(startIso).getTime();
  return () => {
    const out = new Date(ms);
    ms += 1000;
    return out;
  };
}

function makeEngine() {
  const interviewRepo = createInMemoryTacitInterviewRepository({
    now: fixedClock('2026-05-26T04:40:00Z'),
  });
  const extractionRepo = createInMemoryTacitExtractionRepository();
  const consentRepo = createInMemoryTacitConsentRepository({
    now: fixedClock('2026-05-26T04:40:00Z'),
  });
  const consent = createConsentManager(consentRepo);
  const extractor = createReferenceEntityExtractor();
  const vectorIndex = createInMemoryVectorIndex();
  const redundancy = createRedundancyChecker(vectorIndex);
  const sink = createInMemoryCognitiveMemorySink();
  const cellWriter = createCellWriter(sink);

  const engine = createInterviewEngine({
    interviewRepo,
    extractionRepo,
    consent,
    extractor,
    redundancy,
    cellWriter,
    now: fixedClock('2026-05-26T04:40:00Z'),
    chunkSize: 2,
  });

  return {
    engine,
    consent,
    extractor,
    redundancy,
    cellWriter,
    vectorIndex,
    sink,
    interviewRepo,
    extractionRepo,
  };
}

describe('interview engine — orchestration', () => {
  it('start fails when subject has not granted consent', async () => {
    const { engine } = makeEngine();
    await expect(
      engine.start({
        tenantId: 'tnt-1',
        subjectUserId: 'subj-1',
        mode: 'walk-the-floor',
      }),
    ).rejects.toBeInstanceOf(TacitKnowledgeError);
  });

  it('happy path: extracts + persists into cognitive-memory on second subject turn', async () => {
    const ctx = makeEngine();
    await ctx.consent.grant('subj-1', 'tnt-1');

    const interview = await ctx.engine.start({
      tenantId: 'tnt-1',
      subjectUserId: 'subj-1',
      mode: 'walk-the-floor',
      locationGeog: { lat: -2.882, lng: 32.193 },
    });
    expect(interview.status).toBe('running');

    // Mr. Mwikila's opening question (does not yield extractions).
    await ctx.engine.appendTurn({
      interviewId: interview.id,
      tenantId: 'tnt-1',
      turn: {
        speaker: 'mr-mwikila',
        text: 'What are you listening for right now?',
        at: '2026-05-26T04:41:00Z',
      },
    });

    // Subject's reply — this is turn 2 and crosses the chunk threshold.
    const turnResult = await ctx.engine.appendTurn({
      interviewId: interview.id,
      tenantId: 'tnt-1',
      turn: {
        speaker: 'subject',
        text:
          'You must listen for the high whine when number three loads up. If it lasts longer than two seconds, that is a bearing going.',
        at: '2026-05-26T04:42:00Z',
      },
    });
    expect(turnResult.extractionsPersisted.length).toBeGreaterThan(0);
    const firstExtraction = turnResult.extractionsPersisted[0]!;
    expect(firstExtraction.persistedCellId).not.toBeNull();
    expect(ctx.sink.observeCalls.length).toBeGreaterThan(0);
    expect(ctx.sink.observeCalls[0]!.mode).toBe('walk-the-floor');
    expect(ctx.sink.observeCalls[0]!.subjectUserId).toBe('subj-1');

    const completed = await ctx.engine.complete({
      interviewId: interview.id,
      tenantId: 'tnt-1',
    });
    expect(completed.status).toBe('ended_ok');
  });

  it('consent revoked mid-session flips interview to ended_revoked and blocks further writes', async () => {
    const ctx = makeEngine();
    await ctx.consent.grant('subj-1', 'tnt-1');
    const interview = await ctx.engine.start({
      tenantId: 'tnt-1',
      subjectUserId: 'subj-1',
      mode: 'post-incident',
    });
    // Mr. Mwikila's question — no extractions, chunk not yet full.
    await ctx.engine.appendTurn({
      interviewId: interview.id,
      tenantId: 'tnt-1',
      turn: {
        speaker: 'mr-mwikila',
        text: 'Walk me through the last 30 minutes.',
        at: '2026-05-26T08:00:00Z',
      },
    });
    // Revoke before the next chunk crosses the threshold.
    await ctx.consent.revoke('subj-1', 'tnt-1');

    const turnResult = await ctx.engine.appendTurn({
      interviewId: interview.id,
      tenantId: 'tnt-1',
      turn: {
        speaker: 'subject',
        text:
          'The compressor failed twelve minutes after midnight. I had felt something off on Tuesday but did not write it up.',
        at: '2026-05-26T08:01:00Z',
      },
    });
    expect(turnResult.extractionsPersisted.length).toBe(0);
    expect(turnResult.interview.status).toBe('ended_revoked');
    expect(ctx.sink.observeCalls.length).toBe(0);
  });

  it('redundancy hit routes to reinforce rather than observe', async () => {
    const ctx = makeEngine();
    await ctx.consent.grant('subj-2', 'tnt-1');

    // Seed the vector index with a pre-existing cell that matches the
    // subject's first sentence below.
    ctx.vectorIndex.add({
      tenantId: 'tnt-1',
      cellId: 'cell-prior-42',
      text: 'You must leave at 04:40 to clear the Geita weighbridge before the day shift comes on.',
    });

    const interview = await ctx.engine.start({
      tenantId: 'tnt-1',
      subjectUserId: 'subj-2',
      mode: 'ride-along',
    });
    await ctx.engine.appendTurn({
      interviewId: interview.id,
      tenantId: 'tnt-1',
      turn: {
        speaker: 'mr-mwikila',
        text: 'Why are you leaving at this time?',
        at: '2026-05-26T04:35:00Z',
      },
    });
    const turnResult = await ctx.engine.appendTurn({
      interviewId: interview.id,
      tenantId: 'tnt-1',
      turn: {
        speaker: 'subject',
        text:
          'You must leave at 04:40 to clear the Geita weighbridge before the day shift comes on.',
        at: '2026-05-26T04:36:00Z',
        gps: { lat: -2.871, lng: 32.221 },
      },
    });
    expect(turnResult.extractionsPersisted.length).toBeGreaterThan(0);
    const first = turnResult.extractionsPersisted[0]!;
    expect(first.novel).toBe(false);
    expect(first.redundantWithCellId).toBe('cell-prior-42');
    // Reinforce path used — not observe.
    expect(ctx.sink.reinforceCalls.length).toBeGreaterThan(0);
    expect(ctx.sink.reinforceCalls[0]!.cellId).toBe('cell-prior-42');
  });
});
