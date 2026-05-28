/**
 * Tab-change intent detector — Wave WORKFORCE-FIXED-TABS.
 *
 * Heuristic local detector that triggers the RequestTabChangeSheet
 * BEFORE we open a brain stream. The brain itself is also reminded
 * not to promise layout changes — but client-side detection lets us
 * pop the sheet instantly and avoid a wasted turn.
 *
 * Pure function. No I/O. Returns the matched tab id if confidence is
 * high enough, otherwise null.
 */

import {
  WORKFORCE_TAB_CATALOG,
  type WorkforceTabSpec
} from '@borjie/persona-runtime'

const TAB_CHANGE_VERBS_EN: ReadonlyArray<string> = [
  'add',
  'enable',
  'turn on',
  'give me',
  'i need',
  'i want',
  'unlock',
  'access',
  'show me',
  'remove',
  'hide',
  'disable'
]

const TAB_CHANGE_VERBS_SW: ReadonlyArray<string> = [
  'nipe',
  'ongeza',
  'washa',
  'fungua',
  'naomba',
  'ondoa',
  'ficha',
  'zima'
]

const TAB_NOUNS_EN: ReadonlyArray<string> = [
  'tab',
  'tabs',
  'access',
  'screen',
  'screens',
  'view',
  'menu'
]

const TAB_NOUNS_SW: ReadonlyArray<string> = [
  'tabo',
  'kichupo',
  'ufikiaji',
  'menyu'
]

export interface DetectedTabChangeIntent {
  readonly matchedTabId: string
  readonly tabLabel: string
  readonly reasonSeed: string
}

/**
 * Quick local check — true when the input mentions at least one
 * change verb AND either (a) a catalog tab id/label OR (b) a generic
 * tab/menu/access noun.
 */
export function detectTabChangeIntent(
  raw: string,
  lang: 'en' | 'sw'
): DetectedTabChangeIntent | null {
  if (!raw) return null
  const text = raw.toLowerCase().trim()
  if (text.length < 4) return null

  const verbList = lang === 'sw' ? TAB_CHANGE_VERBS_SW : TAB_CHANGE_VERBS_EN
  const nounList = lang === 'sw' ? TAB_NOUNS_SW : TAB_NOUNS_EN

  const hasVerb = verbList.some((v) => text.includes(v))
  if (!hasVerb) return null

  const matched: WorkforceTabSpec | undefined = WORKFORCE_TAB_CATALOG.find(
    (spec) => {
      const idTerm = spec.id.toLowerCase()
      const labelTerm = spec.label[lang].toLowerCase()
      return text.includes(idTerm) || text.includes(labelTerm)
    }
  )

  if (matched) {
    return {
      matchedTabId: matched.id,
      tabLabel: matched.label[lang],
      reasonSeed: raw.trim()
    }
  }

  const hasNoun = nounList.some((n) => text.includes(n))
  if (hasNoun) {
    return {
      matchedTabId: '',
      tabLabel: '',
      reasonSeed: raw.trim()
    }
  }

  return null
}
