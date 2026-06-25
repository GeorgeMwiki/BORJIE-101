/**
 * GATE — mobile raw-enum / raw-error-message barrier (round 11, Class A + B).
 *
 * The canon (CLAUDE.md · language-engineering): a raw DB enum token (e.g.
 * `in_progress`, `high`, `cost_saving`) or a raw English `error.message` off
 * the wire rendered under the `sw` locale IS language mixing. This gate is the
 * mutation-provable barrier for the two classes closed this round:
 *
 *   PART 1 — behavioral: every enumLabels resolver returns a localized string
 *     for the full known enum set, NEVER the raw snake_case token, with
 *     complete en/sw parity and real (differing) translations. Mutating a label
 *     map back to the raw token (or dropping a locale) turns this RED.
 *
 *   PART 2 — static: the converted Class-B render sites contain ZERO raw enum
 *     interpolations (`{x.status}`, `{x.severity}`, `{x.kind}`, `{x.phase}`)
 *     and the converted Class-A catch/throw sites render ZERO raw `*.message`.
 *     Reintroducing a raw render turns this RED.
 *
 * Pure node (no JSX) so it runs in the workforce-mobile vitest `node` env.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import en from '../i18n/en.json'
import sw from '../i18n/sw.json'
import {
  severityLabel,
  opportunityKindLabel,
  riskKindLabel,
  taskStatusLabel,
  trainingStatusLabel,
  documentStatusLabel,
  narrativeStatusLabel,
  sitePhaseLabel,
  entityKindLabel,
} from '../i18n/enumLabels'
import type { StringDict } from '../i18n'

const EN = en as unknown as StringDict
const SW = sw as unknown as StringDict

// The full known token set per enum (mirrors the backend enums / unions the
// mobile app renders). Every token MUST localize away from its raw form.
const SEVERITY = ['low', 'medium', 'high', 'critical', 'sovereign'] as const
const OPPORTUNITY_KIND = [
  'cost_saving',
  'revenue',
  'tax_efficiency',
  'regulatory_window',
  'capital',
  'market_timing',
  'operational_arbitrage',
  'hr',
  'compliance_shortcut',
  'estate_planning',
  'counterparty',
  'peer_best_practice',
] as const
const RISK_KIND = [
  'cash_flow',
  'regulatory',
  'operational',
  'hr',
  'compliance',
  'counterparty',
] as const
const TASK_STATUS = ['pending', 'in_progress', 'done', 'blocked', 'cancelled'] as const
const TRAINING_STATUS = ['assigned', 'in_progress', 'completed'] as const
const DOCUMENT_STATUS = [
  'pending_upload',
  'uploaded',
  'processing',
  'ocr_complete',
  'validated',
  'rejected',
  'expired',
  'archived',
] as const
const NARRATIVE_STATUS = [
  'draft',
  'manager_ok',
  'owner_signed',
  'submitted',
  'delivered',
  'superseded',
] as const
const SITE_PHASE = [
  'exploration',
  'development',
  'production',
  'closure',
  'reclamation',
] as const
const ENTITY_KIND = [
  'site',
  'licence',
  'parcel',
  'counterparty',
  'document',
  'scope',
  'employee',
  'subsidiary',
  'custom',
] as const

type Resolver = (token: string, t: StringDict) => string

const RESOLVERS: ReadonlyArray<{
  readonly name: string
  readonly resolve: Resolver
  readonly tokens: ReadonlyArray<string>
}> = [
  { name: 'severity', resolve: severityLabel, tokens: SEVERITY },
  { name: 'opportunityKind', resolve: opportunityKindLabel, tokens: OPPORTUNITY_KIND },
  { name: 'riskKind', resolve: riskKindLabel, tokens: RISK_KIND },
  { name: 'taskStatus', resolve: taskStatusLabel, tokens: TASK_STATUS },
  { name: 'trainingStatus', resolve: trainingStatusLabel, tokens: TRAINING_STATUS },
  { name: 'documentStatus', resolve: documentStatusLabel, tokens: DOCUMENT_STATUS },
  { name: 'narrativeStatus', resolve: narrativeStatusLabel, tokens: NARRATIVE_STATUS },
  { name: 'sitePhase', resolve: sitePhaseLabel, tokens: SITE_PHASE },
  { name: 'entityKind', resolve: entityKindLabel, tokens: ENTITY_KIND },
]

describe('PART 1 — enumLabels never render a raw token, full en/sw parity', () => {
  for (const { name, resolve, tokens } of RESOLVERS) {
    it(`${name}: localizes every token in en + sw, never the raw token`, () => {
      for (const token of tokens) {
        const enLabel = resolve(token, EN)
        const swLabel = resolve(token, SW)
        // Both locales produce a non-empty label.
        expect(enLabel.length, `${name}.${token} en empty`).toBeGreaterThan(0)
        expect(swLabel.length, `${name}.${token} sw empty`).toBeGreaterThan(0)
        // The label is NEVER the raw snake_case enum token (the mixing bug).
        // (Single-word lowercase tokens like `revenue` may legitimately equal
        // their en label, so we only forbid the multi-segment raw form.)
        if (token.includes('_')) {
          expect(enLabel, `${name}.${token} en is raw token`).not.toBe(token)
          expect(swLabel, `${name}.${token} sw is raw token`).not.toBe(token)
        }
        // No residual snake_case underscore leaks into a rendered label.
        expect(swLabel, `${name}.${token} sw has raw underscore`).not.toMatch(/_/)
        expect(enLabel, `${name}.${token} en has raw underscore`).not.toMatch(/_/)
      }
    })

    it(`${name}: en and sw differ for at least one token (real translation)`, () => {
      const anyDiffer = tokens.some((token) => resolve(token, EN) !== resolve(token, SW))
      expect(anyDiffer, `${name} en === sw for all tokens (untranslated)`).toBe(true)
    })

    it(`${name}: no sw label is left as its raw enum token (untranslated stub)`, () => {
      for (const token of tokens) {
        // A sw catalog value equal to the wire token is an untranslated stub —
        // rendering it under `sw` is mixing. Mutating any sw value back to its
        // token turns this RED.
        expect(resolve(token, SW), `${name}.${token} sw left as raw token`).not.toBe(token)
      }
    })
  }

  it('falls back to a humanized label (never the raw token) for an unknown kind', () => {
    // An open-string kind the catalog has not seen must still not render raw.
    const out = opportunityKindLabel('brand_new_kind', SW)
    expect(out).not.toBe('brand_new_kind')
    expect(out).not.toMatch(/_/)
  })

  it('en/sw enum bundles have identical key shape (parity, no missing locale)', () => {
    const enEnums = (EN.enums ?? {}) as Record<string, unknown>
    const swEnums = (SW.enums ?? {}) as Record<string, unknown>
    expect(Object.keys(enEnums).sort()).toEqual(Object.keys(swEnums).sort())
    for (const group of Object.keys(enEnums)) {
      const e = enEnums[group]
      const s = swEnums[group]
      if (e && typeof e === 'object' && s && typeof s === 'object') {
        expect(
          Object.keys(e as Record<string, unknown>).sort(),
          `enums.${group} key parity`
        ).toEqual(Object.keys(s as Record<string, unknown>).sort())
      }
    }
  })
})

// ─── PART 2 — static raw-render scanner ─────────────────────────────────────

const APP_ROOT = join(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(join(APP_ROOT, rel), 'utf8')
}

// Class B — converted enum-render sites. None may interpolate a raw enum
// property directly inside JSX (`{x.status}` / `{x.severity}` / `{x.kind}` /
// `{x.phase}`); every render must flow through a *Label() resolver.
const CLASS_B_FILES: ReadonlyArray<string> = [
  'app/owner/cockpit/index.tsx',
  'app/worker/W-M-13.tsx',
  'app/worker/W-M-18.tsx',
  'app/worker/W-M-22.tsx',
  'app/(manager)/inspection/[id]/narrative.tsx',
  'app/(manager)/tasks/index.tsx',
  'app/(tabs)/sites.tsx',
  'src/chat/ComposerMenu.tsx',
]

// A raw enum interpolation: `{<ident>.status}` etc. directly inside JSX with no
// call (no `(`). `styles.*` is a StyleSheet prop, not a data render, so it is
// excluded — only a *data* object's enum field rendered raw is the bug.
const RAW_ENUM_RENDER =
  /\{\s*(?!styles\.)[A-Za-z_$][\w$]*\.(status|severity|kind|phase)\s*\}/g

describe('PART 2 — Class B render sites carry no raw enum interpolation', () => {
  for (const file of CLASS_B_FILES) {
    it(`${file} renders no raw {x.status|severity|kind|phase}`, () => {
      const src = read(file)
      const hits = src.match(RAW_ENUM_RENDER) ?? []
      expect(hits, `raw enum render(s) in ${file}: ${hits.join(', ')}`).toEqual([])
    })
  }
})

// Class A — converted error-render sites. None may render a raw `*.message`
// (envelope or Error) — errors must localize via `localizeApiError(code,...)`.
const CLASS_A_FILES: ReadonlyArray<string> = [
  'src/components/RequestTabChangeSheet.tsx',
  'src/documents/DocumentExplorer.tsx',
]

// Forbidden: setting state / building UI copy from a raw `.message`.
// (Logger / Error superclass `super(message)` calls are not user-render sites
// and live in api/errors.ts + api.ts, which are excluded here.)
const RAW_MESSAGE_RENDER =
  /(setErrorMessage|setError)\([^)]*\b[\w$]+\.message\b/g

describe('PART 2 — Class A error sites localize by code, not raw message', () => {
  for (const file of CLASS_A_FILES) {
    it(`${file} sets no error state from a raw .message`, () => {
      const src = read(file)
      const hits = src.match(RAW_MESSAGE_RENDER) ?? []
      expect(hits, `raw .message render(s) in ${file}: ${hits.join(', ')}`).toEqual([])
    })

    it(`${file} imports localizeApiError from the shared catalog`, () => {
      const src = read(file)
      expect(src).toMatch(/from ['"]@borjie\/error-catalog['"]/)
    })
  }
})
