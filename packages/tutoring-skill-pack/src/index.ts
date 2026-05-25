/**
 * @borjie/tutoring-skill-pack — Piece H.
 *
 * Socratic adaptive tutor for property + finance concepts. The lesson
 * orchestrator pulls live tenant data via the injected
 * `TutoringDataAdapter` so the worked example references the
 * learner's real numbers (with citations back to the underlying rows).
 *
 * Quick start:
 *
 *   import {
 *     startLesson,
 *     InMemoryConceptStore,
 *     StubTutoringDataAdapter,
 *   } from '@borjie/tutoring-skill-pack';
 *
 *   const session = await startLesson(
 *     { tenantId: 't1', userId: 'u1', conceptSlug: 'net_operating_income' },
 *     {
 *       conceptStore: new InMemoryConceptStore(),
 *       dataAdapter: new StubTutoringDataAdapter({
 *         'payments-ledger.tenant.month_summary': {
 *           values: { gross_income: 100000, op_ex: 35000, noi: 65000, period_label: 'Sept 2025' },
 *           citations: [{ key: 'gross_income', value: 100000, sourceRef: 'ledger:abc-123' }],
 *         },
 *       }),
 *     },
 *   );
 *
 *   let event = session.describeCurrent();
 *   while (event.step !== 'complete') {
 *     console.log(event.message);
 *     const reply = event.waitingForLearner ? await prompt() : null;
 *     event = await session.submit(reply);
 *   }
 */

export type {
  LessonState,
  LessonEvent,
  LessonEngineDeps,
  ConceptStore,
  TutoringDataAdapter,
  MasteryRecorder,
  RunLessonInput,
  TutoringConcept,
  TutoringContent,
  TutoringWorkedExample,
  TutoringCheckUnderstanding,
  TutoringMasteryThresholds,
  TutoringDataBinding,
  DataCitation,
} from './types.js';

export { TutoringEngineError } from './types.js';

export {
  initialState,
  advance,
  nextStep,
  isDontGetIt,
  scoreCheckAnswer,
  pickCitationFocus,
} from './state-machine.js';

export {
  groundWorkedExample,
  substitute,
  StubTutoringDataAdapter,
  type GroundedWorkedExample,
} from './data-grounding.js';

export {
  tutorActionId,
  makeMasteryRecorder,
  noopMasteryRecorder,
  summariseLessonOutcomes,
} from './mastery-gate-integration.js';

export {
  LessonSession,
  startLesson,
  runLesson,
  synthesizePassingReply,
} from './lesson-orchestrator.js';

export {
  BUILT_IN_CONCEPTS,
  InMemoryConceptStore,
} from './built-in-concepts.js';
