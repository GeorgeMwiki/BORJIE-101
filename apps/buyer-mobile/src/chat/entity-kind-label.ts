/**
 * entity-kind-label — locale-driven label for an `EntityItem['kind']`.
 *
 * The `@`-mention menu used to render the RAW enum token (`entity.kind`,
 * e.g. "licence" / "counterparty") verbatim. Under an active `sw` locale a
 * raw English enum token is language mixing — the canon forbids it. This
 * helper resolves every kind through the i18n layer so the chip obeys the
 * active locale, single-language-per-locale by construction.
 *
 * Pure function; the translator (`useTranslation().t`) is injected by the
 * caller so this stays React/DOM-free and unit-testable.
 */
import type { EntityItem } from './composer-triggers'

type EntityKind = EntityItem['kind']

type Translate = (path: string) => string

export function entityKindLabel(kind: EntityKind, t: Translate): string {
  return t(`entity.kind.${kind}`)
}
