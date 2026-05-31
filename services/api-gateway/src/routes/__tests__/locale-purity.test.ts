/**
 * Locale purity guard tests.
 *
 * The Mr. Mwikila persona prompts ship with a "LOCALE LOCK" directive
 * at the top of every English / Swahili variant. These tests are the
 * tripwire — if a future edit accidentally weakens or drops the lock
 * (or re-introduces a hardcoded "Habari" greeting in the English
 * prompt) the suite will fail BEFORE the build ships and reaches
 * visitors.
 *
 * Pure-string assertions only — no provider call, no live model.
 */

import { describe, expect, it } from 'vitest';

import {
  BORJIE_MARKETING_SYSTEM_PROMPT_EN,
  BORJIE_MARKETING_SYSTEM_PROMPT_SW,
  BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN,
  BORJIE_HOME_TEACHING_SYSTEM_PROMPT_SW,
} from '../public-chat.hono.js';

/**
 * Swahili greeting words that MUST NOT appear hardcoded in the English
 * prompt body — visitors complained the model was opening EN sessions
 * with "Habari yako!" which mixes languages. The directive at the top
 * of the EN prompt explicitly forbids them; this test asserts the
 * directive itself contains the forbidden-word inventory so future
 * edits cannot silently shrink it.
 */
const FORBIDDEN_SW_IN_EN_PROMPT = [
  'Habari',
  'Karibu',
  'Asante',
  'Tafadhali',
  'Mwenye',
  'Mfanyabiashara',
  'Mkulima',
];

const FORBIDDEN_EN_IN_SW_PROMPT = [
  'Hello',
  'Welcome',
  'Thanks',
  'Please',
  'Owner',
  'Sorry',
];

describe('locale purity — Mr. Mwikila persona prompts', () => {
  describe('Borjie marketing EN prompt', () => {
    it('opens with the LOCALE LOCK — ENGLISH ONLY directive', () => {
      const first200 = BORJIE_MARKETING_SYSTEM_PROMPT_EN.slice(0, 400);
      expect(first200).toMatch(/LOCALE LOCK\s*[—-]\s*ENGLISH ONLY/);
    });

    it('explicitly forbids the Swahili greeting words in its directive', () => {
      const directive = BORJIE_MARKETING_SYSTEM_PROMPT_EN.slice(0, 1500);
      for (const sw of FORBIDDEN_SW_IN_EN_PROMPT) {
        expect(directive).toContain(sw);
      }
    });

    it('instructs the model to switch language gracefully when the user writes Swahili', () => {
      const directive = BORJIE_MARKETING_SYSTEM_PROMPT_EN.slice(0, 1500);
      expect(directive).toMatch(/respond in English/i);
      expect(directive).toMatch(/switch to Swahili in settings/i);
    });
  });

  describe('Borjie marketing SW prompt', () => {
    it('opens with the KIFUNGO CHA LUGHA — KISWAHILI PEKEE directive', () => {
      const first400 = BORJIE_MARKETING_SYSTEM_PROMPT_SW.slice(0, 400);
      expect(first400).toMatch(/KIFUNGO CHA LUGHA\s*[—-]\s*KISWAHILI PEKEE/);
    });

    it('explicitly forbids the English words in its directive', () => {
      const directive = BORJIE_MARKETING_SYSTEM_PROMPT_SW.slice(0, 1500);
      for (const en of FORBIDDEN_EN_IN_SW_PROMPT) {
        expect(directive).toContain(en);
      }
    });
  });

  describe('Borjie home teaching EN prompt', () => {
    it('opens with the LOCALE LOCK directive', () => {
      const first400 = BORJIE_HOME_TEACHING_SYSTEM_PROMPT_EN.slice(0, 400);
      expect(first400).toMatch(/LOCALE LOCK\s*[—-]\s*ENGLISH ONLY/);
    });
  });

  describe('Borjie home teaching SW prompt', () => {
    it('opens with the KIFUNGO CHA LUGHA directive', () => {
      const first400 = BORJIE_HOME_TEACHING_SYSTEM_PROMPT_SW.slice(0, 400);
      expect(first400).toMatch(/KIFUNGO CHA LUGHA\s*[—-]\s*KISWAHILI PEKEE/);
    });
  });
});
