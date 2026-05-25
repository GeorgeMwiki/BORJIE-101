import { useCallback, useMemo } from 'react'
import { translate } from '@/i18n'
import { getCurrentUser } from '@/auth/session'
import type { LanguageCode } from '@/types/auth'

export interface UseTranslationResult {
  readonly lang: LanguageCode
  readonly t: (path: string) => string
}

export function useTranslation(): UseTranslationResult {
  const user = useMemo(() => getCurrentUser(), [])
  const lang = user.preferredLang
  const t = useCallback((path: string) => translate(lang, path), [lang])
  return { lang, t }
}
