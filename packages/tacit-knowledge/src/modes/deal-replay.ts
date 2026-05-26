/**
 * Mode D — Deal-Replay.
 *
 * Spec: `Docs/DESIGN/TACIT_KNOWLEDGE_HARVEST_SPEC.md` §2.4.
 *
 * Anchor: within hours / days of a commercial conversation — buyer
 * negotiation, regulator call, vendor pricing, partner alignment.
 * The transcript (or the subject's memory of the transcript) is the
 * substrate; Mr. Mwikila walks back through it turn by turn.
 *
 * Cognitive cost is moderate-to-high — explicit reflection on
 * counterfactual choices is the most cognitively demanding mode.
 */

import { freezeTemplate, type ModeTemplate } from './mode-shape.js';

export const dealReplayTemplate: ModeTemplate = freezeTemplate({
  mode: 'deal-replay',
  questions: [
    'At minute [N], when [counterparty] said [X], what did you read in the way they said it?',
    'What would have happened if you had named your price first?',
    'What was the moment you decided where the deal was going?',
    'What did you not say that you could have? Why didn\'t you?',
    'If you were teaching me to take this call cold next week, what would you tell me to listen for?',
    'What did you do that you didn\'t do on the last call with them?',
    'What is the smallest cue that would have flipped your read?',
  ],
  pacing: {
    maxQuestionsInARow: 3,
    maxWordsPerUtterance: 45,
    speechRatioTarget: 2,
    postSubjectDwellMs: 1500,
  },
  density: { min: 12, max: 30 },
  directives: [
    'Walk the deal turn-by-turn. Cite minute markers and counterparty utterances.',
    'Surface paralinguistic cues — pauses, tone shifts, restraint.',
    'Surface counterfactual choices and decisive moments.',
    'Emit transferable rules ("when X happens, do Y") not narrative.',
    'Never name the subject\'s role in user-facing text.',
  ],
});
