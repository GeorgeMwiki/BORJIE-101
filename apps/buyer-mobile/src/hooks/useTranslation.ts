import { useCallback } from 'react'
import { translate, TranslationVars } from '@/i18n'
import { useSession } from '@/auth/session'
import type { LanguageCode } from '@/types/auth'

export interface UseTranslationResult {
  readonly lang: LanguageCode
  readonly t: (path: string, vars?: TranslationVars) => string
}

export function useTranslation(): UseTranslationResult {
  const user = useSession()
  const lang = user.preferredLang
  const t = useCallback((path: string, vars?: TranslationVars) => translate(lang, path, vars), [lang])
  return { lang, t }
}
