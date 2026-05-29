/**
 * Document drafter template registry.
 *
 * Templates are co-located markdown files (one pair per slug; `.sw.md`
 * and `.en.md`) loaded from disk at module-init time. The loader runs
 * synchronously because the template set is finite, immutable, and
 * checked into the repo — paying the I/O cost once at import keeps
 * the drafter pure during request-handling.
 *
 * For the `language='bilingual'` rendering option the composer
 * stitches both files together with a `---` divider.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DraftKind, DraftLanguage } from '@borjie/database/schemas';

// Resolve the template directory relative to this compiled file. tsup
// emits CJS for the api-gateway (no `"type": "module"` in
// package.json), so `import.meta.url` is not allowed. `__dirname` is
// always available at runtime in CommonJS and points at the dist
// folder this file lives in.
const TEMPLATE_DIR = __dirname;
export interface TemplateDefinition {
  /** Canonical slug — used as the persisted `source_template_slug`. */
  readonly slug: string;
  /** Draft kind this template produces. */
  readonly kind: DraftKind;
  /** Default jurisdiction (may be overridden by tenant config). */
  readonly defaultJurisdiction: string;
  /** Human-readable description used in tool descriptions. */
  readonly description: string;
}

/**
 * Static registry of every shipped template. Keep in sync with the
 * paired `.sw.md` / `.en.md` files in this directory.
 */
export const TEMPLATE_REGISTRY: ReadonlyArray<TemplateDefinition> = [
  {
    slug: 'contract.supply-ore',
    kind: 'contract',
    defaultJurisdiction: 'TZ',
    description:
      'Tanzania ore-parcel supply contract: seller (miner) → buyer (off-taker).',
  },
  {
    slug: 'contract.equipment-lease',
    kind: 'contract',
    defaultJurisdiction: 'TZ',
    description: 'Mining equipment lease contract (excavator, truck, drill).',
  },
  {
    slug: 'contract.transport',
    kind: 'contract',
    defaultJurisdiction: 'TZ',
    description:
      'Mineral transport contract (mine → smelter/port). Includes cargo insurance and origin certs.',
  },
  {
    slug: 'rfp.equipment-purchase',
    kind: 'rfp',
    defaultJurisdiction: 'TZ',
    description:
      'RFP to purchase mining equipment (excavators, trucks, processing kit).',
  },
  {
    slug: 'rfp.smelter-services',
    kind: 'rfp',
    defaultJurisdiction: 'TZ',
    description: 'RFP for smelting / refining services (gold, copper, base metals).',
  },
  {
    slug: 'rfp_response.template',
    kind: 'rfp_response',
    defaultJurisdiction: 'TZ',
    description: 'Generic RFP response with cover, technical, commercial, and compliance sections.',
  },
  {
    slug: 'letter.regulator.tumemadini',
    kind: 'letter',
    defaultJurisdiction: 'TZ',
    description: 'Formal letter to the Mining Commission of Tanzania (TUMEMADINI).',
  },
  {
    slug: 'letter.regulator.nemc',
    kind: 'letter',
    defaultJurisdiction: 'TZ',
    description: 'Formal letter to the National Environment Management Council (NEMC).',
  },
  {
    slug: 'letter.bank.bot',
    kind: 'letter',
    defaultJurisdiction: 'TZ',
    description: 'Formal letter to the Bank of Tanzania (BoT) — forex / compliance topics.',
  },
  {
    slug: 'letter.community-grievance',
    kind: 'letter',
    defaultJurisdiction: 'TZ',
    description: 'Response letter to a community grievance.',
  },
  {
    slug: 'notice.lease-renewal',
    kind: 'notice',
    defaultJurisdiction: 'TZ',
    description: 'Notice of intent to renew a lease (equipment, surface rights, premises).',
  },
  {
    slug: 'memo.internal',
    kind: 'memo',
    defaultJurisdiction: 'TZ',
    description: 'Internal memo (operations, safety, HR).',
  },
];

const TEMPLATE_INDEX = new Map<string, TemplateDefinition>(
  TEMPLATE_REGISTRY.map((t) => [t.slug, t]),
);

export function findTemplate(slug: string): TemplateDefinition | undefined {
  return TEMPLATE_INDEX.get(slug);
}

export function listTemplateSlugs(): readonly string[] {
  return TEMPLATE_REGISTRY.map((t) => t.slug);
}

export function listTemplatesByKind(kind: DraftKind): readonly TemplateDefinition[] {
  return TEMPLATE_REGISTRY.filter((t) => t.kind === kind);
}

/**
 * Read the raw markdown for a slug + language. Returns the file
 * contents verbatim — the composer is responsible for placeholder
 * interpolation.
 *
 * Throws if the file is missing (every shipped slug must have both
 * `.sw.md` and `.en.md`).
 */
export function loadTemplateContent(
  slug: string,
  language: DraftLanguage,
): { readonly sw: string; readonly en: string } {
  const def = findTemplate(slug);
  if (!def) {
    throw new Error(`document-drafter: unknown template slug "${slug}"`);
  }
  const swPath = resolve(TEMPLATE_DIR, `${slug}.sw.md`);
  const enPath = resolve(TEMPLATE_DIR, `${slug}.en.md`);
  // slug is resolved through the in-memory TEMPLATE_REGISTRY via
  // findTemplate(), so it is constrained to the closed allow-list
  // above. The fs calls are safe; the eslint rule cannot prove that
  // statically. See `Docs/SECURITY/SECURE_CODING_STANDARDS.md` §3.4.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(swPath)) {
    throw new Error(`document-drafter: missing Swahili template at ${swPath}`);
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(enPath)) {
    throw new Error(`document-drafter: missing English template at ${enPath}`);
  }
  // language argument is for future per-language gating; for now we
  // always read both so the composer can stitch bilingual output.
  void language;
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sw = readFileSync(swPath, 'utf8');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const en = readFileSync(enPath, 'utf8');
  return { sw, en };
}
