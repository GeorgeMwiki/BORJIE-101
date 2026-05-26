/**
 * Mode B — Post-Incident.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2.2.
 *
 * Anchor: within 24–72 hours of an incident — near-miss, breakdown,
 * regulator visit, deal lost, deal won. Sit-down, 45–75 minutes,
 * no calendar pressure.
 *
 * Cognitive cost is moderate. Pacing is slower than walk-the-floor;
 * Mr. Mwikila waits, leaves silence, never interrupts. The framing
 * is **blame-free** — the extractor filters out person-blaming
 * attributions and emits only system / judgement cells.
 *
 * Question shapes adapted from Klein, Calderwood & MacGregor,
 * "Critical Decision Method for Eliciting Knowledge", IEEE Trans.
 * Systems, Man, and Cybernetics, 1989.
 */

import { freezeTemplate, type ModeTemplate } from './mode-shape.js';

export const postIncidentTemplate: ModeTemplate = freezeTemplate({
  mode: 'post-incident',
  questions: [
    'Walk me through the last 30 minutes before it happened, in any order you remember.',
    'What were you expecting to happen, and where did the reality diverge?',
    'What did you almost do but didn\'t?',
    'What would you tell yourself, three hours earlier?',
    'If this happens again, what is the one thing you would want available that was not?',
    'What did you check first when you realised something was wrong?',
    'Was there a signal earlier that, in hindsight, you would now take seriously?',
  ],
  pacing: {
    maxQuestionsInARow: 1,
    maxWordsPerUtterance: 40,
    speechRatioTarget: 4,
    postSubjectDwellMs: 2500,
  },
  density: { min: 15, max: 40 },
  directives: [
    'Blame-free. Do not extract person-blaming attributions.',
    'Leave silence after every subject utterance — at least 2.5 seconds.',
    'Surface system signals + judgement cells; filter out responsibility cells.',
    'Use Klein CDM probes — counterfactuals, decision points, near-misses.',
    'Never name the subject\'s role in user-facing text.',
  ],
});
