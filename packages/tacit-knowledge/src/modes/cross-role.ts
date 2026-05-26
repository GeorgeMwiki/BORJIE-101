/**
 * Mode E — Cross-Role Probe.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2.5.
 *
 * Anchor: two subjects, one teaching the other. Mr. Mwikila is the
 * **silent observer**. The subjects know they are being observed;
 * the explicit task is "Person A, teach Person B how you would do
 * this".
 *
 * Cognitive cost is low for the teacher (they are doing what they
 * already do); moderate for Mr. Mwikila (he is the listener, not
 * the asker, and he must classify each utterance into the correct
 * tacit-cell kind without prompting).
 *
 * NTT Data's "expert apprentice" prototype validated this pattern —
 * tacit knowledge that does not survive a direct interrogation can
 * still be captured when one expert teaches another.
 */

import { freezeTemplate, type ModeTemplate } from './mode-shape.js';

export const crossRoleTemplate: ModeTemplate = freezeTemplate({
  mode: 'cross-role',
  questions: [
    'You said [X] to the other person — was that the most important point, or the most concrete one?',
    'What did the other person miss in their first attempt?',
    'What would the other person have to do for a week before they could do this without you?',
    'Was there anything you taught that you did not realise you knew until you said it out loud?',
  ],
  pacing: {
    maxQuestionsInARow: 1,
    maxWordsPerUtterance: 30,
    speechRatioTarget: 12,
    postSubjectDwellMs: 3000,
  },
  density: { min: 8, max: 20 },
  directives: [
    'Silent observer mode. Do not ask questions during the teaching itself.',
    'Classify every teaching utterance into the right MemoryKind on the fly.',
    'The follow-up questions fire only after the teaching has finished.',
    'High-confidence emissions allowed — two-person dialogue gives ground-truth checks.',
    'Never name the subjects\' roles in user-facing text.',
  ],
});
