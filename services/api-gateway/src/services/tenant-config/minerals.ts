/**
 * Mineral-kinds helpers — Issue #207 (world-scale tenants), WS-5.
 *
 * The platform's MINERAL_CATALOGUE is the global registry of canonical
 * mineral slugs the system knows about. Each row carries the English
 * label, the Swahili label, the typical regulator-set the mineral is
 * licensed under, and a short HS-code hint (Harmonised System
 * commodity code) used for export documentation.
 *
 * Per-tenant gating is handled by `tenant.allowed_minerals` (migration
 * 0143). The `isMineralAllowedForTenant` helper is the single place
 * application code asks "may THIS tenant transact in THIS mineral?".
 *
 * Adding a new mineral is one row in MINERAL_CATALOGUE plus an update
 * to the relevant jurisdiction's defaults in `jurisdictions.ts`.
 */

import type { TenantConfig } from './types.js';

export interface MineralCatalogueEntry {
  /** Canonical slug. Stable across renames. */
  readonly slug: string;
  /** English label rendered in cockpit tables / CTAs. */
  readonly nameEn: string;
  /** Swahili label for the bilingual UI (CLAUDE.md hard rule). */
  readonly nameSw: string;
  /** Spanish / Portuguese / Indonesian fallback for non-TZ tenants. */
  readonly nameLocal: Partial<Record<'es' | 'pt' | 'fr' | 'id', string>>;
  /** HS-2017 commodity code prefix (export docs / royalty calcs). */
  readonly hsCode: string;
  /** Industry-grouping bucket — drives default cockpit pivots. */
  readonly group: 'precious-metal' | 'base-metal' | 'energy' | 'gemstone' | 'industrial-mineral' | 'rare-earth';
}

export const MINERAL_CATALOGUE: ReadonlyArray<MineralCatalogueEntry> =
  Object.freeze([
    Object.freeze({
      slug: 'gold',
      nameEn: 'Gold',
      nameSw: 'Dhahabu',
      nameLocal: { es: 'Oro', pt: 'Ouro', fr: 'Or', id: 'Emas' },
      hsCode: '7108',
      group: 'precious-metal',
    }),
    Object.freeze({
      slug: 'silver',
      nameEn: 'Silver',
      nameSw: 'Fedha',
      nameLocal: { es: 'Plata', pt: 'Prata', fr: 'Argent' },
      hsCode: '7106',
      group: 'precious-metal',
    }),
    Object.freeze({
      slug: 'platinum',
      nameEn: 'Platinum',
      nameSw: 'Platina',
      nameLocal: { es: 'Platino' },
      hsCode: '7110',
      group: 'precious-metal',
    }),
    Object.freeze({
      slug: 'palladium',
      nameEn: 'Palladium',
      nameSw: 'Paladiumu',
      nameLocal: {},
      hsCode: '7110',
      group: 'precious-metal',
    }),
    Object.freeze({
      slug: 'tanzanite',
      nameEn: 'Tanzanite',
      nameSw: 'Tanzanite',
      nameLocal: {},
      hsCode: '7103',
      group: 'gemstone',
    }),
    Object.freeze({
      slug: 'ruby',
      nameEn: 'Ruby',
      nameSw: 'Yakuti',
      nameLocal: {},
      hsCode: '7103',
      group: 'gemstone',
    }),
    Object.freeze({
      slug: 'sapphire',
      nameEn: 'Sapphire',
      nameSw: 'Yakuti samawi',
      nameLocal: {},
      hsCode: '7103',
      group: 'gemstone',
    }),
    Object.freeze({
      slug: 'diamond',
      nameEn: 'Diamond',
      nameSw: 'Almasi',
      nameLocal: { es: 'Diamante', pt: 'Diamante' },
      hsCode: '7102',
      group: 'gemstone',
    }),
    Object.freeze({
      slug: 'gemstone',
      nameEn: 'Gemstone (other)',
      nameSw: 'Vito vingine',
      nameLocal: {},
      hsCode: '7103',
      group: 'gemstone',
    }),
    Object.freeze({
      slug: 'copper',
      nameEn: 'Copper',
      nameSw: 'Shaba',
      nameLocal: { es: 'Cobre', pt: 'Cobre', id: 'Tembaga' },
      hsCode: '7403',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'iron-ore',
      nameEn: 'Iron ore',
      nameSw: 'Madini ya chuma',
      nameLocal: { es: 'Mineral de hierro', id: 'Bijih besi' },
      hsCode: '2601',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'coal',
      nameEn: 'Coal',
      nameSw: 'Makaa ya mawe',
      nameLocal: { es: 'Carbón', id: 'Batubara' },
      hsCode: '2701',
      group: 'energy',
    }),
    Object.freeze({
      slug: 'nickel',
      nameEn: 'Nickel',
      nameSw: 'Nikeli',
      nameLocal: { es: 'Níquel', id: 'Nikel' },
      hsCode: '7502',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'lithium',
      nameEn: 'Lithium',
      nameSw: 'Lithiamu',
      nameLocal: { es: 'Litio' },
      hsCode: '2825',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'graphite',
      nameEn: 'Graphite',
      nameSw: 'Grafiti',
      nameLocal: { es: 'Grafito' },
      hsCode: '2504',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'manganese',
      nameEn: 'Manganese',
      nameSw: 'Manganizi',
      nameLocal: { es: 'Manganeso' },
      hsCode: '2602',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'chrome',
      nameEn: 'Chrome',
      nameSw: 'Kromiamu',
      nameLocal: {},
      hsCode: '2610',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'cobalt',
      nameEn: 'Cobalt',
      nameSw: 'Kobalti',
      nameLocal: {},
      hsCode: '8105',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'molybdenum',
      nameEn: 'Molybdenum',
      nameSw: 'Molibdeni',
      nameLocal: { es: 'Molibdeno' },
      hsCode: '8102',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'tungsten',
      nameEn: 'Tungsten',
      nameSw: 'Tungsten',
      nameLocal: {},
      hsCode: '8101',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'tin',
      nameEn: 'Tin',
      nameSw: 'Bati',
      nameLocal: { id: 'Timah' },
      hsCode: '8001',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'lead-zinc',
      nameEn: 'Lead-Zinc',
      nameSw: 'Risasi-Zinki',
      nameLocal: {},
      hsCode: '2607',
      group: 'base-metal',
    }),
    Object.freeze({
      slug: 'columbite',
      nameEn: 'Columbite',
      nameSw: 'Columbite',
      nameLocal: {},
      hsCode: '2615',
      group: 'rare-earth',
    }),
    Object.freeze({
      slug: 'bitumen',
      nameEn: 'Bitumen',
      nameSw: 'Lami',
      nameLocal: {},
      hsCode: '2714',
      group: 'energy',
    }),
    Object.freeze({
      slug: 'bauxite',
      nameEn: 'Bauxite',
      nameSw: 'Boksiti',
      nameLocal: { id: 'Bauksit' },
      hsCode: '2606',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'rare-earths',
      nameEn: 'Rare earth elements',
      nameSw: 'Madini adimu',
      nameLocal: {},
      hsCode: '2805',
      group: 'rare-earth',
    }),
    Object.freeze({
      slug: 'titanium-bearing-sands',
      nameEn: 'Titanium-bearing sands',
      nameSw: 'Mchanga wenye titaniamu',
      nameLocal: {},
      hsCode: '2614',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'gypsum',
      nameEn: 'Gypsum',
      nameSw: 'Jasi',
      nameLocal: {},
      hsCode: '2520',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'limestone',
      nameEn: 'Limestone',
      nameSw: 'Chokaa',
      nameLocal: {},
      hsCode: '2521',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'fluorspar',
      nameEn: 'Fluorspar',
      nameSw: 'Fluospari',
      nameLocal: {},
      hsCode: '2529',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'phosphate',
      nameEn: 'Phosphate',
      nameSw: 'Fosfeti',
      nameLocal: {},
      hsCode: '2510',
      group: 'industrial-mineral',
    }),
    Object.freeze({
      slug: 'zinc',
      nameEn: 'Zinc',
      nameSw: 'Zinki',
      nameLocal: {},
      hsCode: '7901',
      group: 'base-metal',
    }),
  ]);

const MINERAL_INDEX: ReadonlyMap<string, MineralCatalogueEntry> = new Map(
  MINERAL_CATALOGUE.map((m) => [m.slug, m]),
);

/**
 * Lookup a single mineral by slug. Returns null when unknown.
 */
export function getMineral(slug: string): MineralCatalogueEntry | null {
  return MINERAL_INDEX.get(slug) ?? null;
}

/**
 * Tenant-aware gate. The single source of truth for "may THIS tenant
 * transact in THIS mineral?". Production code MUST use this helper —
 * never compare against a hard-coded set.
 */
export function isMineralAllowedForTenant(
  cfg: TenantConfig,
  slug: string,
): boolean {
  return cfg.allowedMinerals.includes(slug);
}

/**
 * Returns the rendered (en + sw + local) labels for a mineral, picking
 * the local label per tenant language when available.
 */
export function labelForMineral(
  cfg: TenantConfig,
  slug: string,
): { readonly en: string; readonly sw: string; readonly local: string | null } {
  const mineral = getMineral(slug);
  if (!mineral) {
    return Object.freeze({ en: slug, sw: slug, local: null });
  }
  const lang = cfg.defaultLanguage;
  const localKey =
    lang === 'es' || lang === 'pt' || lang === 'fr' || lang === 'id' ? lang : null;
  return Object.freeze({
    en: mineral.nameEn,
    sw: mineral.nameSw,
    local: localKey ? (mineral.nameLocal[localKey] ?? null) : null,
  });
}
