import sw from './sw.json'
import en from './en.json'
import type { Lang } from '../auth/types'

const STRINGS = { sw, en } as const

export type StringDict = typeof sw

export function pickStrings(lang: Lang): StringDict {
  return STRINGS[lang] ?? STRINGS.sw
}

export interface ScreenStrings {
  title: string
  intent: string
}

export function screenStrings(lang: Lang, id: string): ScreenStrings {
  const dict = pickStrings(lang)
  const entry = dict.screens[id as keyof typeof dict.screens] as ScreenStrings | undefined
  if (entry) {
    return entry
  }
  return { title: id, intent: '' }
}
