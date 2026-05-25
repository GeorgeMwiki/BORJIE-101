import sw from './sw.json'
import en from './en.json'
import type { LanguageCode } from '@/types/auth'

const dictionaries = { sw, en } as const

export type Dictionary = typeof sw

export function getDictionary(lang: LanguageCode): Dictionary {
  return dictionaries[lang]
}

export type TranslationPath = string

function resolvePath(dict: Dictionary, path: TranslationPath): string {
  const segments = path.split('.')
  let current: unknown = dict
  for (const segment of segments) {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return path
    }
  }
  return typeof current === 'string' ? current : path
}

export function translate(lang: LanguageCode, path: TranslationPath): string {
  return resolvePath(getDictionary(lang), path)
}
