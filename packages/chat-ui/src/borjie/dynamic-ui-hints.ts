/**
 * Borjie dynamic-UI hint catalogue — DU-2 audit fix.
 *
 * The ProactiveHint, MasteryGate, and LearnedShortcutsPanel components
 * in `packages/chat-ui/src/components/` are domain-neutral by design
 * (they have to ship into BossNyumba + Borjie + other consumers). This
 * module supplies the BORJIE-SPECIFIC bilingual (sw/en) hint copy and
 * mastery-gate strings so apps can wire them with a single import.
 *
 * Apps consume:
 *
 *   import {
 *     borjieProactiveHints,
 *     borjieMasteryGateCopy,
 *     borjieLearnedShortcutsHeadline,
 *   } from '@borjie/chat-ui';
 *
 *   <ProactiveHint
 *     profile={profile}
 *     hints={borjieProactiveHints(language)}
 *     dismissAriaLabel={language === 'sw' ? 'Funga' : 'Dismiss'}
 *   />
 *
 * Bilingual contract:
 *   - Every string ships sw + en. Picker `(lang: 'sw'|'en') => string`.
 *   - Default language is `sw` per Borjie hard rule (`CLAUDE.md`).
 *   - Copy is concise; the panel renders a single line.
 *
 * Why this lives in chat-ui (not apps/owner-web): the same catalogue
 * is consumed by owner-web AND workforce-mobile AND buyer-mobile so
 * the hint experience is consistent across surfaces. App-local
 * overrides remain possible — callers pass a custom HintCandidate[]
 * when they want a surface-specific message.
 */

import type { HintCandidate } from '../components/ProactiveHint.js';

/**
 * Local alias used only inside this module's signatures. The canonical
 * type ships from `./useBorjieChat` (`export type BorjieLanguage`). We
 * re-declare here to keep this file's import surface narrow; the values
 * are structurally identical.
 */
type BorjieLanguageLocal = 'sw' | 'en';

/**
 * Build the Borjie default ProactiveHint catalogue for the given
 * language. Returned array is frozen so callers can't mutate it (a
 * downstream test bug once shipped an array.push that broke other
 * tenants' hints — never again).
 *
 * The catalogue covers the four canonical TOM triggers:
 *   - frustration ≥ 0.5  → "Want a human?" hand-off
 *   - comprehension ≤ 0.4 → "Explain simply" rewrite
 *   - anxiety ≥ 0.6       → "Your data is safe." reassurance
 *   - idle (parent-driven) → "Try Cmd-K" passive teaching
 *
 * Action `emit` strings are stable identifiers — apps switch/case on
 * them in their `proactive-hint:action` event listener. NEVER eval.
 */
export function borjieProactiveHints(
  language: BorjieLanguageLocal,
): ReadonlyArray<HintCandidate> {
  if (language === 'sw') {
    return Object.freeze([
      Object.freeze<HintCandidate>({
        id: 'borjie.frustration.handoff',
        trigger: 'frustration',
        threshold: 0.5,
        title: 'Inaonekana hii inachukua muda mrefu kuliko ulivyotarajia.',
        body: 'Ungependa kuongea na mtu?',
        action: { label: 'Ongea na mtu', emit: 'borjie:handoff:human' },
      }),
      Object.freeze<HintCandidate>({
        id: 'borjie.comprehension.simpler',
        trigger: 'comprehension',
        threshold: 0.4,
        title: 'Je, niielezee kwa lugha rahisi zaidi?',
        body: 'Ninaweza kuvunja maelezo hatua kwa hatua.',
        action: { label: 'Elezea kwa urahisi', emit: 'borjie:explain:simpler' },
      }),
      Object.freeze<HintCandidate>({
        id: 'borjie.anxiety.safety',
        trigger: 'anxiety',
        threshold: 0.6,
        title: 'Data yako iko salama.',
        body: 'Sifanyi vitendo visivyoweza kurudishwa bila ruhusa yako.',
      }),
      Object.freeze<HintCandidate>({
        id: 'borjie.idle.cmdk',
        trigger: 'idle',
        threshold: 0,
        title: 'Kidokezo: Cmd-K hufungua paji ya amri.',
        body: 'Tafuta menyu, tabu, na taarifa kwa haraka.',
        action: { label: 'Funza', emit: 'borjie:teach:cmdk' },
      }),
    ]) as ReadonlyArray<HintCandidate>;
  }
  return Object.freeze([
    Object.freeze<HintCandidate>({
      id: 'borjie.frustration.handoff',
      trigger: 'frustration',
      threshold: 0.5,
      title: 'Looks like this is taking longer than expected.',
      body: 'Want to chat with a human?',
      action: { label: 'Talk to a human', emit: 'borjie:handoff:human' },
    }),
    Object.freeze<HintCandidate>({
      id: 'borjie.comprehension.simpler',
      trigger: 'comprehension',
      threshold: 0.4,
      title: 'Want me to explain this in simpler terms?',
      body: 'I can break this down step by step.',
      action: { label: 'Explain simply', emit: 'borjie:explain:simpler' },
    }),
    Object.freeze<HintCandidate>({
      id: 'borjie.anxiety.safety',
      trigger: 'anxiety',
      threshold: 0.6,
      title: 'Your data is safe.',
      body: 'I never run irreversible actions without your confirmation.',
    }),
    Object.freeze<HintCandidate>({
      id: 'borjie.idle.cmdk',
      trigger: 'idle',
      threshold: 0,
      title: 'Tip: Cmd-K opens the command palette.',
      body: 'Find menus, tabs, and insights in one keystroke.',
      action: { label: 'Show me', emit: 'borjie:teach:cmdk' },
    }),
  ]) as ReadonlyArray<HintCandidate>;
}

/**
 * MasteryGate locked-state copy. The component itself interpolates
 * `{level}` into the template; this catalogue swaps the template per
 * language so the entire string is bilingual.
 */
export interface BorjieMasteryGateCopy {
  readonly hintTemplate: string;
  readonly dismissAriaLabel: string;
}

export function borjieMasteryGateCopy(
  language: BorjieLanguageLocal,
): BorjieMasteryGateCopy {
  if (language === 'sw') {
    return Object.freeze({
      hintTemplate: 'Hupatikana ukifikia kiwango cha {level}',
      dismissAriaLabel: 'Funga kidokezo',
    });
  }
  return Object.freeze({
    hintTemplate: 'Unlocks at {level} level',
    dismissAriaLabel: 'Dismiss hint',
  });
}

/**
 * LearnedShortcutsPanel headline copy — bilingual.
 *
 * Owner-cockpit + workforce-mobile use the same panel; both wire this
 * helper for consistent "Your shortcuts" / "Njia zako za mkato" copy.
 */
export function borjieLearnedShortcutsHeadline(
  language: BorjieLanguageLocal,
): string {
  return language === 'sw' ? 'Njia zako za mkato' : 'Your shortcuts';
}
