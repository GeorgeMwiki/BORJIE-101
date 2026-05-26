/**
 * Mode C — Ride-Along.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2.3.
 *
 * Anchor: in-vehicle, in motion. GPS is recording. Subject is the
 * person whose route knowledge Mr. Mwikila wants — driver, mineral
 * runner, field surveyor with regulator stops, or the owner on a
 * buyer-visit circuit.
 *
 * Cognitive cost is low-to-moderate. Mr. Mwikila joins via voice;
 * the subject narrates the route. Every Mr. Mwikila utterance is
 * GPS-tagged on capture; every artifact extracted is geo-stamped.
 *
 * Sensitive route knowledge (e.g. which weighbridge clerk shift is
 * lenient) is flagged by the extractor for restricted scope.
 */

import { freezeTemplate, type ModeTemplate } from './mode-shape.js';

export const rideAlongTemplate: ModeTemplate = freezeTemplate({
  mode: 'ride-along',
  questions: [
    "Why did you choose this road over the alternative?",
    "What's the cue that tells you to leave now versus 30 minutes later?",
    "If you saw a convoy / police vehicle / weighbridge queue ahead, what would you change?",
    "Who knows you on this stretch? What do they want from you?",
    "What time of year is this route different?",
    "What is the worst thing that could happen here, and how do you prepare for it?",
    "Where do you usually stop, and why this place not the next one?",
  ],
  pacing: {
    maxQuestionsInARow: 2,
    maxWordsPerUtterance: 28,
    speechRatioTarget: 5,
    postSubjectDwellMs: 1200,
  },
  density: { min: 10, max: 25 },
  directives: [
    'In-vehicle. Every turn is GPS-tagged on capture.',
    'Surface timing heuristics, conditional routing, seasonal patterns.',
    'Flag sensitive route knowledge for restricted scope (owner-only).',
    'Surface relational + regulatory knowledge along the route.',
    'Never name the subject\'s role in user-facing text.',
  ],
});
