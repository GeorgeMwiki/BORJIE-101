/**
 * Universal regulatory citations cited at the vertical-profile level
 * (Wave VP-1).
 *
 * These eleven anchors satisfy the deep-research provenance budget
 * (≥4 citations URL+title+date). Every reserved profile inherits the
 * subset relevant to its vertical via the `mkProvenance` helper.
 *
 * Cross-reference: Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md §6.
 *
 * @module @borjie/vertical-profiles/seeds/citations
 */

import type { Citation } from '../types.js';

const ACCESSED = '2026-05-27';

export const ICMM_MINING: Citation = Object.freeze({
  url: 'https://www.icmm.com/en-gb/our-work/sustainability-leadership/mining-principles',
  title: 'ICMM Mining Principles 2025',
  accessedAt: ACCESSED,
});

export const EITI_STANDARD: Citation = Object.freeze({
  url: 'https://eiti.org/eiti-standard',
  title: 'World Bank EITI Standard 2023',
  accessedAt: ACCESSED,
});

export const USDA_FAS: Citation = Object.freeze({
  url: 'https://www.fas.usda.gov/data',
  title: 'USDA Foreign Agricultural Service Reports',
  accessedAt: ACCESSED,
});

export const FAO_FOREST: Citation = Object.freeze({
  url: 'https://www.fao.org/forest-resources-assessment/en',
  title: 'FAO Global Forest Resources Assessment 2025',
  accessedAt: ACCESSED,
});

export const API_STANDARDS: Citation = Object.freeze({
  url: 'https://www.api.org/products-and-services/standards',
  title: 'American Petroleum Institute (API) Standards Catalogue 2026',
  accessedAt: ACCESSED,
});

export const FSC_STANDARDS: Citation = Object.freeze({
  url: 'https://fsc.org/en/document-centre',
  title: 'Forest Stewardship Council FSC-STD-01-001 V5-2',
  accessedAt: ACCESSED,
});

export const UN_REDD: Citation = Object.freeze({
  url: 'https://www.un-redd.org/about-un-redd-programme',
  title: 'UN-REDD+ Programme Framework 2024',
  accessedAt: ACCESSED,
});

export const ISO_14001: Citation = Object.freeze({
  url: 'https://www.iso.org/standard/60857.html',
  title: 'ISO 14001:2015 Environmental Management Systems',
  accessedAt: ACCESSED,
});

export const GRI_STANDARDS: Citation = Object.freeze({
  url: 'https://www.globalreporting.org/standards',
  title: 'GRI Standards 2021 Universal + Sector Set',
  accessedAt: ACCESSED,
});

export const UNWTO: Citation = Object.freeze({
  url: 'https://www.unwto.org/tourism-statistics',
  title: 'UN World Tourism Organization Statistical Framework',
  accessedAt: ACCESSED,
});

export const IFRS_16: Citation = Object.freeze({
  url: 'https://www.ifrs.org/issued-standards/list-of-standards/ifrs-16-leases',
  title: 'IFRS 16 Leases (IASB 2016, effective 2019)',
  accessedAt: ACCESSED,
});

/**
 * Anchor citations per vertical. Used by `mkProvenance` to seed the
 * baseline provenance array on every reserved profile.
 */
export const VERTICAL_ANCHORS: Readonly<
  Record<string, ReadonlyArray<Citation>>
> = Object.freeze({
  mining: [ICMM_MINING, EITI_STANDARD, ISO_14001, GRI_STANDARDS],
  agri: [USDA_FAS, ISO_14001, GRI_STANDARDS],
  oilgas: [API_STANDARDS, EITI_STANDARD, ISO_14001, GRI_STANDARDS],
  fisheries: [FAO_FOREST, ISO_14001, GRI_STANDARDS],
  forestry: [FAO_FOREST, FSC_STANDARDS, UN_REDD, ISO_14001, GRI_STANDARDS],
  manufacturing: [ISO_14001, GRI_STANDARDS],
  tourism: [UNWTO, ISO_14001, GRI_STANDARDS],
  realestate: [IFRS_16, GRI_STANDARDS],
});
