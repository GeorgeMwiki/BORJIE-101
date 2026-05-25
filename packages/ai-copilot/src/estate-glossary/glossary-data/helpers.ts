/**
 * Internal data helpers used by the per-category glossary files.
 *
 * The raw `GlossaryEntry` shape is verbose; these helpers let us build
 * large lists of entries without 30-line object literals for each.
 *
 * Everything here is internal to the `glossary-data/` folder — the
 * public surface of the module is in `types.ts`, `lookup.ts`, and
 * the barrel `index.ts`.
 */

import {
  GlossaryCategory,
  GlossaryEntry,
  Jurisdiction,
  LegalCitation,
  Locale,
  withEnglishOnly,
} from '../types.js';

/**
 * Compact specification of a glossary entry. The helpers expand it
 * into a fully-populated `GlossaryEntry` with frozen translation map.
 */
export interface EntrySpec {
  readonly id: string;
  readonly en: string;
  readonly def: string;
  readonly juris: readonly Jurisdiction[];
  readonly cat: GlossaryCategory;
  readonly t?: Partial<Record<Locale, string>>;
  readonly cite?: LegalCitation;
  readonly syn?: readonly string[];
  readonly related?: readonly string[];
  readonly notes?: string;
}

export function buildEntry(spec: EntrySpec): GlossaryEntry {
  const entry: GlossaryEntry = {
    termId: spec.id,
    english: spec.en,
    translations: withEnglishOnly(spec.en, spec.t ?? {}),
    jurisdictions: Object.freeze([...spec.juris]),
    category: spec.cat,
    definition: spec.def,
    ...(spec.cite ? { legalCitation: spec.cite } : {}),
    ...(spec.syn ? { synonyms: Object.freeze([...spec.syn]) } : {}),
    ...(spec.related ? { relatedTerms: Object.freeze([...spec.related]) } : {}),
    ...(spec.notes ? { notes: spec.notes } : {}),
  };
  return Object.freeze(entry);
}

export function buildEntries(specs: readonly EntrySpec[]): readonly GlossaryEntry[] {
  return Object.freeze(specs.map(buildEntry));
}

/**
 * Generate a batch of `English-only` entries quickly. Used by the
 * lower-priority categories (hr/insurance/marketing/procurement/
 * maintenance/legal-proceedings) where the spec allows English-only
 * as v1.
 *
 * Each tuple is `[termId, english, definition, jurisdictions?]`.
 */
export function enOnlyBatch(
  cat: GlossaryCategory,
  defaultJurisdictions: readonly Jurisdiction[],
  rows: ReadonlyArray<
    readonly [string, string, string, ReadonlyArray<Jurisdiction>?]
  >,
): readonly GlossaryEntry[] {
  return Object.freeze(
    rows.map(([id, en, def, juris]) =>
      buildEntry({
        id,
        en,
        def,
        cat,
        juris: juris ?? defaultJurisdictions,
      }),
    ),
  );
}
