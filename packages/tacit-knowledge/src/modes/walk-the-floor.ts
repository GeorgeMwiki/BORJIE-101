/**
 * Mode A — Walk-the-Floor.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2.1.
 *
 * Anchor: the subject is *on shift, doing the work*. Voice-first via
 * handset. 8–20 minute sessions, opportunistic.
 *
 * Cognitive cost is the lowest of the five modes — Mr. Mwikila waits
 * for the subject to finish what they're doing, never asks more than
 * 2 questions in a row, and targets a 6:1 speech ratio.
 */

import { freezeTemplate, type ModeTemplate } from './mode-shape.js';

export const walkTheFloorTemplate: ModeTemplate = freezeTemplate({
  mode: 'walk-the-floor',
  questions: [
    "What are you looking at right now?",
    "What would tell you it's going wrong?",
    "If I asked someone new to do this in your place, what would they get wrong on the first day?",
    "Last time this happened, what did you do that you didn't have to be told to do?",
    "What's the cue you check first?",
    "What does it normally sound / look / feel like when it's healthy?",
  ],
  pacing: {
    maxQuestionsInARow: 2,
    maxWordsPerUtterance: 22,
    speechRatioTarget: 6,
    postSubjectDwellMs: 800,
  },
  density: { min: 6, max: 12 },
  directives: [
    'Voice-first. Subject is mid-shift and physically engaged.',
    'Never interrupt. Wait for the subject to finish what they are doing.',
    'Prefer concrete cue-based questions (what do you see / hear / smell).',
    'Surface unwritten rules and discretionary judgement, not procedures.',
    'Do not reference the subject by their job title in user-facing text.',
  ],
});
