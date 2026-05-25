import sw from './sw.json'
import en from './en.json'
import type { LanguageCode } from '@/types/auth'

const dictionaries = { sw, en } as const

export type Dictionary = typeof sw

export function getDictionary(lang: LanguageCode): Dictionary {
  return dictionaries[lang]
}

export type TranslationPath = string
export type TranslationVars = Readonly<Record<string, string | number>>

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

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) {
    return template
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key]
    return value === undefined ? `{{${key}}}` : String(value)
  })
}

export function translate(lang: LanguageCode, path: TranslationPath, vars?: TranslationVars): string {
  return interpolate(resolvePath(getDictionary(lang), path), vars)
}
