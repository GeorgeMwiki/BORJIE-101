/**
 * Legal-proceedings glossary. Tribunal / court / enforcement vocabulary.
 * Citations intentionally scoped to KE + GB where statute refs are
 * stable; remaining jurisdictions flagged TODO-L18N.
 */

import { buildEntries, enOnlyBatch, type EntrySpec } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

const CORE_SPECS: readonly EntrySpec[] = [
  {
    id: 'legal.possession_order',
    en: 'possession order',
    def: 'Court order granting landlord legal possession of premises.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'ZA', 'IN'],
    cite: { jurisdiction: 'GB', statuteRef: 'Housing Act 1988', section: 's.7', year: 1988 },
    t: { sw: 'amri ya umiliki' },
  },
  {
    id: 'legal.warrant_of_possession',
    en: 'warrant of possession',
    def: 'Court order authorising bailiff enforcement of a possession order.',
    cat: 'legal_proceedings',
    juris: ['GB'],
  },
  {
    id: 'legal.notice_to_quit',
    en: 'notice to quit',
    def: 'Formal written notice ending a periodic tenancy.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'IN', 'ZA'],
    t: { sw: 'notisi ya kuondoka', fr: 'congé', de: 'Kündigung' },
  },
  {
    id: 'legal.eviction',
    en: 'eviction',
    def: 'Removal of a tenant from premises by court-authorised process.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'US', 'ZA', 'IN', 'AE'],
    t: { sw: 'kufukuzwa', ar: 'إخلاء', fr: 'expulsion', de: 'Räumung', ko: '퇴거', ja: '立ち退き' },
  },
  {
    id: 'legal.tribunal',
    en: 'tribunal',
    def: 'Quasi-judicial body with jurisdiction over tenancy disputes.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'AU', 'CA'],
    t: { sw: 'mahakama ya kodi' },
  },
  {
    id: 'legal.business_premises_tribunal',
    en: 'business premises rent tribunal',
    def: 'Kenyan tribunal with jurisdiction over protected business tenancies.',
    cat: 'legal_proceedings',
    juris: ['KE'],
    cite: { jurisdiction: 'KE', statuteRef: 'Cap 301', section: 's.12', year: 1965 },
    t: { sw: 'mahakama ya biashara' },
  },
  {
    id: 'legal.mediation',
    en: 'mediation',
    def: 'Facilitated negotiation to resolve tenancy disputes without adjudication.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'US', 'DE', 'AE'],
    t: { sw: 'upatanishi', ar: 'وساطة', fr: 'médiation', de: 'Mediation' },
  },
  {
    id: 'legal.adjudication',
    en: 'adjudication',
    def: 'Binding decision by an appointed adjudicator on a tenancy dispute.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'AU'],
  },
  {
    id: 'legal.set_aside',
    en: 'set-aside application',
    def: 'Application to rescind a court order previously made in the applicant’s absence.',
    cat: 'legal_proceedings',
    juris: ['GB'],
  },
  {
    id: 'legal.stay_of_execution',
    en: 'stay of execution',
    def: 'Court order temporarily halting enforcement of a judgment.',
    cat: 'legal_proceedings',
    juris: ['GB', 'KE', 'US', 'IN'],
  },
];

const EXTRA_ROWS: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>?]> = [
  ['legal.court_fee', 'court fee', 'Fee payable to issue or progress proceedings.'],
  ['legal.particulars_of_claim', 'particulars of claim', 'Written statement setting out the claimant’s case.'],
  ['legal.defence', 'defence', 'Written response by the defendant to particulars of claim.'],
  ['legal.counterclaim', 'counterclaim', 'Claim asserted by a defendant against a claimant.'],
  ['legal.statement_of_truth', 'statement of truth', 'Signed declaration that statements are true to the signatory’s belief.'],
  ['legal.witness_statement', 'witness statement', 'Written evidence signed by a witness for use at trial.'],
  ['legal.service', 'service of documents', 'Formal delivery of proceedings on a party.'],
  ['legal.address_for_service', 'address for service', 'Address at which proceedings are validly served.'],
  ['legal.directions_hearing', 'directions hearing', 'Court hearing to set the procedural timetable.'],
  ['legal.case_management_conference', 'case management conference', 'Directions hearing in civil proceedings.'],
  ['legal.bailiff', 'bailiff', 'Officer who executes court-ordered possession warrants.'],
  ['legal.high_court_enforcement', 'High Court enforcement officer', 'Enforcement officer authorised under High Court writs.', ['GB']],
  ['legal.ground_for_possession', 'ground for possession', 'Statutory ground on which possession may be sought.'],
  ['legal.mandatory_ground', 'mandatory ground', 'Ground on which the court must order possession if proved.'],
  ['legal.discretionary_ground', 'discretionary ground', 'Ground on which the court may order possession where reasonable.'],
  ['legal.accelerated_possession', 'accelerated possession procedure', 'Paper-only procedure for AST possession.', ['GB']],
  ['legal.injunction', 'injunction', 'Court order restraining a party from conduct.'],
  ['legal.anti_social_behaviour', 'anti-social behaviour injunction', 'Injunction restraining nuisance by occupants.'],
  ['legal.breach_of_covenant', 'breach of covenant', 'Failure to comply with a lease covenant.'],
  ['legal.forfeiture', 'forfeiture', 'Termination of lease for breach of covenant.'],
  ['legal.relief_from_forfeiture', 'relief from forfeiture', 'Equitable remedy restoring a forfeited lease.'],
  ['legal.waiver', 'waiver', 'Landlord conduct treating the lease as subsisting despite breach.'],
  ['legal.estoppel', 'estoppel', 'Principle preventing a party from denying a stated position relied on by another.'],
  ['legal.limitation_period', 'limitation period', 'Statutory time-limit for commencing proceedings.'],
];

export const LEGAL_PROCEEDINGS_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  ...buildEntries(CORE_SPECS),
  ...enOnlyBatch('legal_proceedings', ['GB', 'KE'], EXTRA_ROWS),
]);
