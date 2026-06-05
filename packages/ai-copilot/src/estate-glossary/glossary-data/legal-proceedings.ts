/**
 * Legal-proceedings glossary (mining domain). Mining Commission /
 * tribunal / court / enforcement vocabulary for mineral-right disputes
 * and licence enforcement. Citations scoped to TZ + KE where statute
 * refs are stable. Core mineral-right tenure terms live in
 * `./mining-rights.ts`; this file is the enforcement chain.
 */

import { buildEntries, enOnlyBatch, type EntrySpec } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

const CORE_SPECS: readonly EntrySpec[] = [
  {
    id: 'legal.suspension_order',
    en: 'suspension order',
    def: 'Mining Commission order temporarily suspending a mineral right for breach pending cure.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'GH', 'ZA'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Mining Act', section: 's.45', year: 2010 },
    t: { sw: 'amri ya kusimamisha leseni' },
  },
  {
    id: 'legal.revocation_order',
    en: 'revocation order',
    def: 'Cancellation of a mineral right for serious or uncured breach of its conditions.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'GH'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Mining Act', section: 's.46', year: 2010 },
  },
  {
    id: 'legal.default_notice',
    en: 'default notice',
    def: 'Formal written notice of breach giving a cure period before suspension or revocation.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: { sw: 'notisi ya ukiukaji', fr: 'mise en demeure', de: 'Mahnung' },
  },
  {
    id: 'legal.licence_cancellation',
    en: 'licence cancellation',
    def: 'Termination of a mineral right by the regulator following due process.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'GH', 'ZA'],
    t: { sw: 'kufutwa kwa leseni', ar: 'إلغاء الرخصة', fr: 'annulation de permis', de: 'Lizenzentzug' },
  },
  {
    id: 'legal.mining_commission',
    en: 'Mining Commission',
    def: 'The statutory body administering grants, transfers, renewals, suspensions, and disputes for mineral rights.',
    cat: 'legal_proceedings',
    juris: ['TZ'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Mining Act', section: 's.20', year: 2017 },
    t: { sw: 'Tume ya Madini' },
  },
  {
    id: 'legal.mining_tribunal',
    en: 'mining disputes tribunal',
    def: 'Quasi-judicial body with jurisdiction over mineral-right and mining-contract disputes.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'AU', 'CA'],
    t: { sw: 'baraza la migogoro ya madini' },
  },
  {
    id: 'legal.mediation',
    en: 'mediation',
    def: 'Facilitated negotiation to resolve mining disputes without adjudication.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'US', 'DE', 'AE'],
    t: { sw: 'upatanishi', ar: 'وساطة', fr: 'médiation', de: 'Mediation' },
  },
  {
    id: 'legal.adjudication',
    en: 'adjudication',
    def: 'Binding decision by an appointed adjudicator on a mining dispute.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'AU'],
  },
  {
    id: 'legal.stay_of_execution',
    en: 'stay of execution',
    def: 'Court order temporarily halting enforcement of a judgment or regulator decision.',
    cat: 'legal_proceedings',
    juris: ['TZ', 'KE', 'GB', 'IN'],
  },
];

const EXTRA_ROWS: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>?]> = [
  ['legal.court_fee', 'court fee', 'Fee payable to issue or progress proceedings.'],
  ['legal.particulars_of_claim', 'particulars of claim', 'Written statement setting out the claimant’s case.'],
  ['legal.defence', 'defence', 'Written response by the respondent to particulars of claim.'],
  ['legal.counterclaim', 'counterclaim', 'Claim asserted by a respondent against a claimant.'],
  ['legal.statement_of_truth', 'statement of truth', 'Signed declaration that statements are true to the signatory’s belief.'],
  ['legal.witness_statement', 'witness statement', 'Written evidence signed by a witness for use at hearing.'],
  ['legal.service', 'service of documents', 'Formal delivery of proceedings on a party.'],
  ['legal.address_for_service', 'address for service', 'Address at which proceedings are validly served.'],
  ['legal.directions_hearing', 'directions hearing', 'Hearing to set the procedural timetable.'],
  ['legal.case_management_conference', 'case management conference', 'Directions hearing in proceedings.'],
  ['legal.distress_for_royalty', 'distress for royalty', 'Statutory process to recover outstanding royalty against a defaulter.', ['TZ']],
  ['legal.consignment_seizure', 'consignment seizure', 'Detention of a mineral consignment pending payment or investigation.', ['TZ', 'GH']],
  ['legal.ground_for_revocation', 'ground for revocation', 'Statutory ground on which a mineral right may be revoked.'],
  ['legal.mandatory_ground', 'mandatory ground', 'Ground on which the regulator must act if proved.'],
  ['legal.discretionary_ground', 'discretionary ground', 'Ground on which the regulator may act where reasonable.'],
  ['legal.appeal_to_minister', 'appeal to the Minister', 'Statutory appeal against a Mining Commission decision.', ['TZ']],
  ['legal.injunction', 'injunction', 'Court order restraining a party from conduct.'],
  ['legal.encroachment_claim', 'encroachment claim', 'Action over mining beyond a lawful licence boundary.', ['TZ', 'GH', 'ZA']],
  ['legal.overlapping_claim_dispute', 'overlapping-claim dispute', 'Dispute where two holders assert rights over the same ground.', ['TZ', 'GH', 'ZA']],
  ['legal.breach_of_condition', 'breach of licence condition', 'Failure to comply with a mineral-right condition.'],
  ['legal.forfeiture', 'forfeiture', 'Loss of a mineral right or bond for breach of condition.'],
  ['legal.relief_from_forfeiture', 'relief from forfeiture', 'Equitable remedy restoring a forfeited right.'],
  ['legal.waiver', 'waiver', 'Regulator or owner conduct treating a right as subsisting despite breach.'],
  ['legal.limitation_period', 'limitation period', 'Statutory time-limit for commencing proceedings.'],
];

export const LEGAL_PROCEEDINGS_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  ...buildEntries(CORE_SPECS),
  ...enOnlyBatch('legal_proceedings', ['TZ', 'KE'], EXTRA_ROWS),
]);
