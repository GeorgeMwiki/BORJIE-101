import { useMemo } from 'react'
import { useAuth } from '../auth/useAuth'
import { pickStrings, screenStrings, type StringDict, type ScreenStrings } from './index'
import type { Lang } from '../auth/types'

export interface I18nHook {
  lang: Lang
  t: StringDict
  screen: (id: string) => ScreenStrings
}

export function useI18n(): I18nHook {
  const { user } = useAuth()
  const lang: Lang = user?.preferredLang ?? 'sw'
  return useMemo<I18nHook>(() => ({
    lang,
    t: pickStrings(lang),
    screen: (id: string) => screenStrings(lang, id)
  }), [lang])
}
