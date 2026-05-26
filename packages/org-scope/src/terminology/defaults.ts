/**
 * Default terminology catalogue (Wave 18X §4).
 *
 * Every "named thing" the platform surfaces has a default entry here.
 * Tenants override via the `terminology_overrides` table — see
 * `terminology/resolver.ts` for the resolution algorithm.
 *
 * Rules:
 *   - Keys are stable. Never rename a key — add a new one and deprecate
 *     the old one through a migration.
 *   - Every entry MUST have en + sw pairs. Bilingual TZ pilot.
 *   - Every new domain noun introduced by any wave MUST add a row here
 *     in the same PR.
 *
 * Categories:
 *   org_structure   — hierarchy + organisational artefacts
 *   people          — humans, roles, identifiers
 *   asset           — physical or logical things owned
 *   process         — work, events, time-blocks
 *   compliance      — regulatory + audit nouns
 *   commerce        — marketplace, deals, settlements
 */

import type { TerminologyDefault } from '../types.js';

export const DEFAULT_TERMINOLOGY: ReadonlyArray<TerminologyDefault> = [
  // ── org_structure ────────────────────────────────────────────────
  {
    key: 'org_unit',
    singular_en: 'department',
    plural_en: 'departments',
    singular_sw: 'idara',
    plural_sw: 'idara',
    category: 'org_structure',
    description: 'A sub-organisational unit (district, branch, division, ward, etc.).',
  },
  {
    key: 'tenant',
    singular_en: 'organisation',
    plural_en: 'organisations',
    singular_sw: 'shirika',
    plural_sw: 'mashirika',
    category: 'org_structure',
    description: 'The root organisation that owns a Borjie installation.',
  },
  {
    key: 'team',
    singular_en: 'team',
    plural_en: 'teams',
    singular_sw: 'timu',
    plural_sw: 'timu',
    category: 'org_structure',
    description: 'A small working group inside an org unit.',
  },
  {
    key: 'branch',
    singular_en: 'branch',
    plural_en: 'branches',
    singular_sw: 'tawi',
    plural_sw: 'matawi',
    category: 'org_structure',
    description: 'A physical office or location of an org unit.',
  },

  // ── people ───────────────────────────────────────────────────────
  {
    key: 'owner',
    singular_en: 'owner',
    plural_en: 'owners',
    singular_sw: 'mmiliki',
    plural_sw: 'wamiliki',
    category: 'people',
    description: 'Apex tenant authority.',
  },
  {
    key: 'admin',
    singular_en: 'admin',
    plural_en: 'admins',
    singular_sw: 'msimamizi',
    plural_sw: 'wasimamizi',
    category: 'people',
    description: 'Owner-delegated administrator.',
  },
  {
    key: 'manager',
    singular_en: 'manager',
    plural_en: 'managers',
    singular_sw: 'meneja',
    plural_sw: 'mameneja',
    category: 'people',
    description: 'Operational lead inside an org unit.',
  },
  {
    key: 'supervisor',
    singular_en: 'supervisor',
    plural_en: 'supervisors',
    singular_sw: 'msimamizi mkuu',
    plural_sw: 'wasimamizi wakuu',
    category: 'people',
    description: 'Shift-level lead.',
  },
  {
    key: 'worker',
    singular_en: 'worker',
    plural_en: 'workers',
    singular_sw: 'mfanyakazi',
    plural_sw: 'wafanyakazi',
    category: 'people',
    description: 'A person employed by the tenant.',
  },
  {
    key: 'employee',
    singular_en: 'employee',
    plural_en: 'employees',
    singular_sw: 'mwajiriwa',
    plural_sw: 'waajiriwa',
    category: 'people',
    description: 'Formally employed staff member.',
  },
  {
    key: 'buyer',
    singular_en: 'buyer',
    plural_en: 'buyers',
    singular_sw: 'mnunuzi',
    plural_sw: 'wanunuzi',
    category: 'people',
    description: 'External marketplace participant who purchases output.',
  },
  {
    key: 'customer',
    singular_en: 'customer',
    plural_en: 'customers',
    singular_sw: 'mteja',
    plural_sw: 'wateja',
    category: 'people',
    description: 'External party using the public marketplace.',
  },
  {
    key: 'auditor',
    singular_en: 'auditor',
    plural_en: 'auditors',
    singular_sw: 'mkaguzi',
    plural_sw: 'wakaguzi',
    category: 'people',
    description: 'External read-only audit user.',
  },

  // ── asset ────────────────────────────────────────────────────────
  {
    key: 'site',
    singular_en: 'site',
    plural_en: 'sites',
    singular_sw: 'mgodi',
    plural_sw: 'migodi',
    category: 'asset',
    description: 'A physical mining or operating location.',
  },
  {
    key: 'parcel',
    singular_en: 'parcel',
    plural_en: 'parcels',
    singular_sw: 'kifurushi',
    plural_sw: 'vifurushi',
    category: 'asset',
    description: 'A discrete unit of saleable mineral output.',
  },
  {
    key: 'drill_hole',
    singular_en: 'drill hole',
    plural_en: 'drill holes',
    singular_sw: 'shimo la kuchimba',
    plural_sw: 'mashimo ya kuchimba',
    category: 'asset',
    description: 'A geological drill record.',
  },
  {
    key: 'fleet_asset',
    singular_en: 'fleet asset',
    plural_en: 'fleet assets',
    singular_sw: 'gari la kazi',
    plural_sw: 'magari ya kazi',
    category: 'asset',
    description: 'A movable operating asset (truck, loader, generator).',
  },

  // ── process ──────────────────────────────────────────────────────
  {
    key: 'shift',
    singular_en: 'shift',
    plural_en: 'shifts',
    singular_sw: 'zamu',
    plural_sw: 'zamu',
    category: 'process',
    description: 'A work-time block.',
  },
  {
    key: 'incident',
    singular_en: 'incident',
    plural_en: 'incidents',
    singular_sw: 'tukio',
    plural_sw: 'matukio',
    category: 'compliance',
    description: 'A safety or regulatory event requiring follow-up.',
  },
  {
    key: 'inspection',
    singular_en: 'inspection',
    plural_en: 'inspections',
    singular_sw: 'ukaguzi',
    plural_sw: 'kaguzi',
    category: 'compliance',
    description: 'A scheduled compliance check.',
  },
  {
    key: 'assay',
    singular_en: 'assay',
    plural_en: 'assays',
    singular_sw: 'uchunguzi wa madini',
    plural_sw: 'uchunguzi wa madini',
    category: 'process',
    description: 'A laboratory mineral analysis.',
  },
  {
    key: 'payroll_entry',
    singular_en: 'payroll entry',
    plural_en: 'payroll entries',
    singular_sw: 'malipo ya mshahara',
    plural_sw: 'malipo ya mishahara',
    category: 'process',
    description: 'A single payroll line item.',
  },
  {
    key: 'briefing',
    singular_en: 'briefing',
    plural_en: 'briefings',
    singular_sw: 'taarifa fupi',
    plural_sw: 'taarifa fupi',
    category: 'process',
    description: 'The daily MD briefing artifact.',
  },
  {
    key: 'report',
    singular_en: 'report',
    plural_en: 'reports',
    singular_sw: 'ripoti',
    plural_sw: 'ripoti',
    category: 'process',
    description: 'A composed analytical or status document.',
  },

  // ── compliance ───────────────────────────────────────────────────
  {
    key: 'contract',
    singular_en: 'contract',
    plural_en: 'contracts',
    singular_sw: 'mkataba',
    plural_sw: 'mikataba',
    category: 'compliance',
    description: 'A legally binding agreement.',
  },
  {
    key: 'certification',
    singular_en: 'certification',
    plural_en: 'certifications',
    singular_sw: 'cheti',
    plural_sw: 'vyeti',
    category: 'compliance',
    description: 'An issued credential for a person or asset.',
  },
  {
    key: 'licence',
    singular_en: 'licence',
    plural_en: 'licences',
    singular_sw: 'leseni',
    plural_sw: 'leseni',
    category: 'compliance',
    description: 'A regulatory permit issued to a tenant or site.',
  },
  {
    key: 'return',
    singular_en: 'return',
    plural_en: 'returns',
    singular_sw: 'taarifa ya kurudisha',
    plural_sw: 'taarifa za kurudisha',
    category: 'compliance',
    description: 'A statutory periodic return.',
  },
  {
    key: 'filing',
    singular_en: 'filing',
    plural_en: 'filings',
    singular_sw: 'wasilisho',
    plural_sw: 'mawasilisho',
    category: 'compliance',
    description: 'A regulatory submission record.',
  },
  {
    key: 'submission',
    singular_en: 'submission',
    plural_en: 'submissions',
    singular_sw: 'uwasilishaji',
    plural_sw: 'uwasilishaji',
    category: 'compliance',
    description: 'An external party submission (KYB, application).',
  },
  {
    key: 'audit',
    singular_en: 'audit',
    plural_en: 'audits',
    singular_sw: 'ukaguzi rasmi',
    plural_sw: 'kaguzi rasmi',
    category: 'compliance',
    description: 'A formal audit engagement.',
  },
  {
    key: 'kyb_record',
    singular_en: 'KYB record',
    plural_en: 'KYB records',
    singular_sw: 'rekodi ya KYB',
    plural_sw: 'rekodi za KYB',
    category: 'compliance',
    description: 'A Know-Your-Business diligence record.',
  },
  {
    key: 'kpi',
    singular_en: 'KPI',
    plural_en: 'KPIs',
    singular_sw: 'kiashiria muhimu',
    plural_sw: 'viashiria muhimu',
    category: 'compliance',
    description: 'Key performance indicator.',
  },

  // ── commerce ─────────────────────────────────────────────────────
  {
    key: 'marketplace_listing',
    singular_en: 'listing',
    plural_en: 'listings',
    singular_sw: 'orodha ya soko',
    plural_sw: 'orodha za soko',
    category: 'commerce',
    description: 'A marketplace offer.',
  },
  {
    key: 'deal',
    singular_en: 'deal',
    plural_en: 'deals',
    singular_sw: 'makubaliano',
    plural_sw: 'makubaliano',
    category: 'commerce',
    description: 'A negotiated transaction between buyer and seller.',
  },
  {
    key: 'settlement',
    singular_en: 'settlement',
    plural_en: 'settlements',
    singular_sw: 'malipo ya makubaliano',
    plural_sw: 'malipo ya makubaliano',
    category: 'commerce',
    description: 'Funds disbursement for a closed deal.',
  },
  {
    key: 'fx_position',
    singular_en: 'FX position',
    plural_en: 'FX positions',
    singular_sw: 'nafasi ya fedha za kigeni',
    plural_sw: 'nafasi za fedha za kigeni',
    category: 'commerce',
    description: 'A foreign-currency exposure record.',
  },
  {
    key: 'hedge',
    singular_en: 'hedge',
    plural_en: 'hedges',
    singular_sw: 'kinga ya bei',
    plural_sw: 'kinga za bei',
    category: 'commerce',
    description: 'A price-risk mitigation instrument.',
  },

  // ── UI nouns (dynamic UI & doc-templates) ────────────────────────
  {
    key: 'document',
    singular_en: 'document',
    plural_en: 'documents',
    singular_sw: 'hati',
    plural_sw: 'hati',
    category: 'process',
    description: 'A composed document artifact.',
  },
  {
    key: 'tab',
    singular_en: 'tab',
    plural_en: 'tabs',
    singular_sw: 'kichupo',
    plural_sw: 'vichupo',
    category: 'process',
    description: 'A dynamic-UI tab.',
  },
  {
    key: 'dashboard',
    singular_en: 'dashboard',
    plural_en: 'dashboards',
    singular_sw: 'dashibodi',
    plural_sw: 'dashibodi',
    category: 'process',
    description: 'A composed analytical view.',
  },
  {
    key: 'home',
    singular_en: 'home',
    plural_en: 'home views',
    singular_sw: 'mwanzo',
    plural_sw: 'mwanzo',
    category: 'process',
    description: 'The home-shell view.',
  },
  {
    key: 'search',
    singular_en: 'search',
    plural_en: 'searches',
    singular_sw: 'tafuta',
    plural_sw: 'tafuta',
    category: 'process',
    description: 'A search query result.',
  },
  {
    key: 'profile',
    singular_en: 'profile',
    plural_en: 'profiles',
    singular_sw: 'wasifu',
    plural_sw: 'wasifu',
    category: 'people',
    description: 'A user or entity profile page.',
  },

  // ── evolution proposals + campaigns (governance) ────────────────
  {
    key: 'evolution_proposal',
    singular_en: 'evolution proposal',
    plural_en: 'evolution proposals',
    singular_sw: 'pendekezo la mabadiliko',
    plural_sw: 'mapendekezo ya mabadiliko',
    category: 'process',
    description: 'A proposed change to UI, doc, or recipe configuration.',
  },
  {
    key: 'ui_proposal',
    singular_en: 'UI proposal',
    plural_en: 'UI proposals',
    singular_sw: 'pendekezo la kiolesura',
    plural_sw: 'mapendekezo ya kiolesura',
    category: 'process',
    description: 'A UI evolution worker proposal.',
  },
  {
    key: 'doc_proposal',
    singular_en: 'document proposal',
    plural_en: 'document proposals',
    singular_sw: 'pendekezo la hati',
    plural_sw: 'mapendekezo ya hati',
    category: 'process',
    description: 'A doc evolution worker proposal.',
  },
  {
    key: 'campaign',
    singular_en: 'campaign',
    plural_en: 'campaigns',
    singular_sw: 'kampeni',
    plural_sw: 'kampeni',
    category: 'commerce',
    description: 'A marketing-studio campaign.',
  },
];

/**
 * Quick lookup map keyed by the stable terminology key.
 *
 * Frozen at module-load — callers must never mutate.
 */
export const DEFAULT_TERMINOLOGY_BY_KEY: ReadonlyMap<string, TerminologyDefault> =
  new Map(DEFAULT_TERMINOLOGY.map((entry) => [entry.key, entry]));
