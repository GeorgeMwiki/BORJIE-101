import { useEffect, useMemo } from 'react'
import { useAuth } from '../auth/useAuth'
import { pickStrings, screenStrings, type StringDict, type ScreenStrings } from './index'
import { setActiveLocale } from './active-locale'
import type { Lang } from '../auth/types'

export interface I18nHook {
  lang: Lang
  t: StringDict
  screen: (id: string) => ScreenStrings
}

export function useI18n(): I18nHook {
  const { user } = useAuth()
  // Default user language is EN (CLAUDE.md "English default · bilingual sw/en");
  // a Tanzanian user opts into `sw` via settings. Defaulting to `sw` here
  // rendered Swahili to a user who never chose it — the sw-by-default mixing
  // trap. Resolve the active locale from the user, falling to `en` when unset.
  const lang: Lang = user?.preferredLang ?? 'en'
  // Mirror the resolved locale into the module cache so hook-less surfaces
  // (PilotErrorBoundary, a root class component) can render the active language
  // synchronously on a crash instead of a hardcoded one.
  useEffect(() => {
    setActiveLocale(lang)
  }, [lang])
  return useMemo<I18nHook>(() => ({
    lang,
    t: pickStrings(lang),
    screen: (id: string) => screenStrings(lang, id)
  }), [lang])
}
