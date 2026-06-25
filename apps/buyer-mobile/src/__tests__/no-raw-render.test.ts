import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import en from '../i18n/en.json'
import sw from '../i18n/sw.json'
import { translate } from '../i18n'
import { entityKindLabel } from '../chat/entity-kind-label'
import type { EntityItem } from '../chat/composer-triggers'

/**
 * Round-11 review-door gate (buyer-mobile) — the raw-render barrier.
 *
 * Two classes, mutation-proven:
 *   CLASS A (raw error.message render): a gateway `error.message` rendered
 *     verbatim is English off the wire — under `sw` that is language mixing.
 *     Error UI must localize through `@borjie/error-catalog`.
 *   CLASS B (raw enum render): rendering a raw enum token (`entity.kind`,
 *     e.g. "licence" / "counterparty") is an untranslated English token —
 *     under `sw` it is mixing. Enum chips must localize via `entity.kind.*`.
 *
 * The gate is BEHAVIORAL (entityKindLabel + key parity) AND STATIC (a source
 * scan of the fixed files), so reintroducing either smell flips a test RED.
 *
 * Pure-data only — we read the i18n JSON + helper directly, and scan source
 * text. We never import the .tsx components (they pull react-native →
 * expo-secure-store and trip the vitest rollup parser, same constraint as
 * src/__tests__/bids-i18n.test.ts).
 */

const APP_ROOT = resolve(__dirname, '..')

function readSource(relPath: string): string {
  return readFileSync(resolve(APP_ROOT, relPath), 'utf8')
}

// Every member of EntityItem['kind'] — the @-mention chip enum.
const ENTITY_KINDS: ReadonlyArray<EntityItem['kind']> = [
  'site',
  'licence',
  'parcel',
  'counterparty',
  'document',
  'scope',
  'employee',
  'subsidiary',
  'custom',
]

const LOCALES = ['en', 'sw'] as const

describe('CLASS B — entity.kind localization (no raw enum render)', () => {
  it('resolves EVERY entity kind to real copy in both locales (no key passthrough)', () => {
    for (const locale of LOCALES) {
      for (const kind of ENTITY_KINDS) {
        const label = entityKindLabel(kind, (path) => translate(locale, path))
        // A missing key returns the raw path — that IS the bug we guard.
        expect(label).not.toBe(`entity.kind.${kind}`)
        expect(label.length).toBeGreaterThan(0)
        // The raw enum token must not be what we render under sw (mixing).
        if (locale === 'sw') {
          expect(label).not.toBe(kind)
        }
      }
    }
  })

  it('carries entity.kind parity across en + sw (no gap → no EN/SW mixing)', () => {
    const enKinds = (en.entity as { kind: Record<string, unknown> }).kind
    const swKinds = (sw.entity as { kind: Record<string, unknown> }).kind
    for (const kind of ENTITY_KINDS) {
      expect(typeof enKinds[kind]).toBe('string')
      expect((enKinds[kind] as string).length).toBeGreaterThan(0)
      expect(typeof swKinds[kind]).toBe('string')
      expect((swKinds[kind] as string).length).toBeGreaterThan(0)
    }
  })

  it('ComposerMenu does not render the raw {entity.kind} enum token', () => {
    const src = readSource('chat/ComposerMenu.tsx')
    // Mutation tripwire: the old leak was `{entity.kind}` inside JSX.
    expect(src).not.toMatch(/\{\s*entity\.kind\s*\}/)
    // And it must route through the localizer.
    expect(src).toContain('entityKindLabel(entity.kind')
  })
})

describe('CLASS A — error localization (no raw error.message render)', () => {
  it('documents.upload_* error keys carry en + sw parity', () => {
    const keys = ['upload_no_file', 'upload_failed', 'attach_document', 'upload_document'] as const
    const enDocs = en.documents as Record<string, unknown>
    const swDocs = sw.documents as Record<string, unknown>
    for (const key of keys) {
      expect(typeof enDocs[key]).toBe('string')
      expect((enDocs[key] as string).length).toBeGreaterThan(0)
      expect(typeof swDocs[key]).toBe('string')
      expect((swDocs[key] as string).length).toBeGreaterThan(0)
    }
  })

  it('DocumentExplorer localizes the catch — never renders cause.message', () => {
    const src = readSource('documents/DocumentExplorer.tsx')
    expect(src).toContain('localizeApiError(')
    // Mutation tripwire: setError(cause.message) / setError(... .message) leak.
    expect(src).not.toMatch(/setError\([^)]*\.message/)
  })

  it('DocumentUploadButton localizes the catch + validation — never raw .message', () => {
    const src = readSource('documents/DocumentUploadButton.tsx')
    expect(src).toContain('localizeApiError(')
    // The old leaks: onError?.(cause.message) and onError?.(validation.message).
    expect(src).not.toMatch(/onError\?\.\([^)]*\.message\b/)
    // No raw English literals as user-facing fallbacks.
    expect(src).not.toContain("'No file selected.'")
    expect(src).not.toContain("'Upload failed.'")
    expect(src).not.toContain("'Attach document'")
    expect(src).not.toContain("'Upload document'")
  })

  it('magic-link never shows the raw Supabase error.message as an alert body', () => {
    const src = readSource('auth/magic-link.tsx')
    // Mutation tripwire: Alert.alert(t.genericError, error.message) leaked
    // raw English under sw.
    expect(src).not.toMatch(/Alert\.alert\([^)]*,\s*\w*\.?(error|err)\??\.message/)
  })
})
