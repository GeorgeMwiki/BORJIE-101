/**
 * composer-triggers — RN-native port of @borjie/chat-ui/composer
 * trigger-parser. Pure functions only — no React, no DOM. Used by the
 * buyer HomeChat composer to render the slash + at menus inline above
 * the input. The shared chat-ui package is web-only because its menu
 * components use <div> + CSS; the parser logic itself is platform-
 * neutral so we mirror it here to keep the mobile bundle React-Native-
 * pure.
 */

export type TriggerKind = 'slash' | 'at' | 'none'

export interface TriggerState {
  readonly kind: TriggerKind
  readonly query: string
  readonly anchor: number
  readonly caret: number
}

export interface ComposerSelection {
  readonly text: string
  readonly caret: number
}

const TRIGGER_SLASH = '/'
const TRIGGER_AT = '@'
const WHITESPACE = /\s/
const ENTITY_WORD = /[\w\-./@:]/

export function parseTrigger(text: string, caret: number): TriggerState {
  if (caret < 0 || caret > text.length) {
    return { kind: 'none', query: '', anchor: caret, caret }
  }
  let index = caret - 1
  while (index >= 0) {
    const ch = text[index]
    if (ch === undefined) break
    if (ch === TRIGGER_SLASH || ch === TRIGGER_AT) {
      const prev = index === 0 ? '' : text[index - 1]
      if (prev !== '' && prev !== undefined && !WHITESPACE.test(prev)) {
        return { kind: 'none', query: '', anchor: caret, caret }
      }
      const query = text.slice(index + 1, caret)
      if (WHITESPACE.test(query)) {
        return { kind: 'none', query: '', anchor: caret, caret }
      }
      return {
        kind: ch === TRIGGER_SLASH ? 'slash' : 'at',
        query,
        anchor: index,
        caret
      }
    }
    if (WHITESPACE.test(ch)) {
      return { kind: 'none', query: '', anchor: caret, caret }
    }
    if (!ENTITY_WORD.test(ch)) {
      return { kind: 'none', query: '', anchor: caret, caret }
    }
    index -= 1
  }
  return { kind: 'none', query: '', anchor: caret, caret }
}

export interface SlashCommandItem {
  readonly id: string
  readonly label: { readonly en: string; readonly sw: string }
  readonly hint?: { readonly en: string; readonly sw: string }
  readonly personaSlugs?: ReadonlyArray<string>
}

export function filterSlashCommands(
  catalog: ReadonlyArray<SlashCommandItem>,
  query: string,
  options?: { readonly personaSlug?: string; readonly locale?: 'en' | 'sw' }
): ReadonlyArray<SlashCommandItem> {
  const needle = query.trim().toLowerCase()
  const persona = options?.personaSlug
  const locale = options?.locale ?? 'en'
  return catalog.filter((cmd) => {
    if (
      persona &&
      cmd.personaSlugs &&
      cmd.personaSlugs.length > 0 &&
      !cmd.personaSlugs.includes(persona)
    ) {
      return false
    }
    if (needle.length === 0) return true
    const label = cmd.label[locale].toLowerCase()
    const hint = cmd.hint?.[locale].toLowerCase() ?? ''
    return (
      cmd.id.toLowerCase().includes(needle) ||
      label.includes(needle) ||
      hint.includes(needle)
    )
  })
}

export interface EntityItem {
  readonly id: string
  readonly label: { readonly en: string; readonly sw: string }
  readonly kind:
    | 'site'
    | 'licence'
    | 'parcel'
    | 'counterparty'
    | 'document'
    | 'scope'
    | 'employee'
    | 'subsidiary'
    | 'custom'
  readonly hint?: { readonly en: string; readonly sw: string }
}

export function filterEntities(
  catalog: ReadonlyArray<EntityItem>,
  query: string,
  options?: {
    readonly kinds?: ReadonlyArray<EntityItem['kind']>
    readonly locale?: 'en' | 'sw'
  }
): ReadonlyArray<EntityItem> {
  const needle = query.trim().toLowerCase()
  const locale = options?.locale ?? 'en'
  const kindFilter = options?.kinds
  return catalog.filter((entity) => {
    if (kindFilter && !kindFilter.includes(entity.kind)) return false
    if (needle.length === 0) return true
    const label = entity.label[locale].toLowerCase()
    return (
      entity.id.toLowerCase().includes(needle) ||
      label.includes(needle)
    )
  })
}

export function applySelection(
  current: ComposerSelection,
  trigger: TriggerState,
  selected: { readonly token: string }
): ComposerSelection {
  const before = current.text.slice(0, trigger.anchor)
  const after = current.text.slice(trigger.caret)
  const token = selected.token.endsWith(' ')
    ? selected.token
    : `${selected.token} `
  const nextText = `${before}${token}${after}`
  return {
    text: nextText,
    caret: before.length + token.length
  }
}
