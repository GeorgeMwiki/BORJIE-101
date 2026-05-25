/**
 * Baseline test fixtures for the multi-script harness. These cover the
 * minimum locales/scripts/scenarios we refuse to regress on. Adding a
 * new tenant locale means extending this list — the harness is the
 * regression gate.
 */

import type { ScriptTestCase, TestRubric } from './types.js';
import { validateRubricWeights } from './types.js';

const EVEN_WEIGHTED: TestRubric = Object.freeze({
  grammarWeight: 0.25,
  scriptCorrectnessWeight: 0.25,
  registerFitWeight: 0.25,
  culturalAppropriatenessWeight: 0.25,
});

const LEGAL_WEIGHTED: TestRubric = Object.freeze({
  grammarWeight: 0.3,
  scriptCorrectnessWeight: 0.35,
  registerFitWeight: 0.25,
  culturalAppropriatenessWeight: 0.1,
});

const CHAT_WEIGHTED: TestRubric = Object.freeze({
  grammarWeight: 0.2,
  scriptCorrectnessWeight: 0.3,
  registerFitWeight: 0.25,
  culturalAppropriatenessWeight: 0.25,
});

validateRubricWeights(EVEN_WEIGHTED);
validateRubricWeights(LEGAL_WEIGHTED);
validateRubricWeights(CHAT_WEIGHTED);

export const BASELINE_TEST_CASES: readonly ScriptTestCase[] = Object.freeze([
  {
    id: 'rent-reminder-sw-KE',
    locale: 'sw-KE',
    script: 'Latn',
    testPrompt: 'Draft a friendly rent reminder to a tenant in Nairobi, 3 days overdue.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'rent-reminder',
  },
  {
    id: 'rent-reminder-en-GB',
    locale: 'en-GB',
    script: 'Latn',
    testPrompt: 'Draft a friendly rent reminder to a tenant in London, 3 days overdue.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'rent-reminder',
  },
  {
    id: 'arrears-notice-ar-AE',
    locale: 'ar-AE',
    script: 'Arab',
    testPrompt: 'Draft a formal 14-day arrears notice in Arabic for a Dubai tenant.',
    expectedRubric: LEGAL_WEIGHTED,
    scenario: 'arrears-notice',
  },
  {
    id: 'lease-renewal-de-DE',
    locale: 'de-DE',
    script: 'Latn',
    testPrompt: 'Prepare a lease-renewal offer letter for a Berlin tenant under BGB §557.',
    expectedRubric: LEGAL_WEIGHTED,
    scenario: 'lease-renewal',
  },
  {
    id: 'move-out-ko-KR',
    locale: 'ko-KR',
    script: 'Hang',
    testPrompt: 'Compose a 전세/월세 move-out checklist notification in polite Korean.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'move-out',
  },
  {
    id: 'regulator-letter-ja-JP',
    locale: 'ja-JP',
    script: 'Hani',
    testPrompt: 'Draft a courteous regulator response letter citing 借地借家法.',
    expectedRubric: LEGAL_WEIGHTED,
    scenario: 'regulator-letter',
  },
  {
    id: 'viewing-confirmation-fr-FR',
    locale: 'fr-FR',
    script: 'Latn',
    testPrompt: 'Confirm a viewing appointment in Paris for Saturday at 10:30.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'viewing-confirmation',
  },
  {
    id: 'deposit-dispute-hi-IN',
    locale: 'hi-IN',
    script: 'Deva',
    testPrompt: 'Respond to a security-deposit dispute in Hindi citing fair wear and tear.',
    expectedRubric: LEGAL_WEIGHTED,
    scenario: 'deposit-dispute',
  },
  {
    id: 'portfolio-briefing-en-KE',
    locale: 'en-KE',
    script: 'Latn',
    testPrompt: 'Summarise overnight autonomous actions for the head of estates in Nairobi.',
    expectedRubric: EVEN_WEIGHTED,
    scenario: 'portfolio-briefing',
  },
  {
    id: 'tenant-welcome-zh-CN',
    locale: 'zh-CN',
    script: 'Hani',
    testPrompt: 'Welcome a new tenant to a Beijing unit with move-in checklist.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'tenant-welcome',
  },
  {
    id: 'code-switch-sw-en-KE',
    locale: 'sw-KE',
    script: 'Latn',
    testPrompt: 'Greet the tenant warmly and then switch into English for the rent breakdown.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'code-switch',
  },
  {
    id: 'maintenance-update-pt-BR',
    locale: 'pt-BR',
    script: 'Latn',
    testPrompt: 'Update tenant on status of plumbing work order in São Paulo.',
    expectedRubric: CHAT_WEIGHTED,
    scenario: 'maintenance-update',
  },
  {
    id: 'owner-statement-es-MX',
    locale: 'es-MX',
    script: 'Latn',
    testPrompt: 'Explain the monthly owner statement including retenciones.',
    expectedRubric: EVEN_WEIGHTED,
    scenario: 'owner-statement',
  },
]);

export { EVEN_WEIGHTED, LEGAL_WEIGHTED, CHAT_WEIGHTED };
