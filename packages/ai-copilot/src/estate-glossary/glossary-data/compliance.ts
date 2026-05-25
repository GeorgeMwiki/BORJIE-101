/**
 * Compliance-related glossary. Covers licensing, gas/fire safety,
 * fit-for-human-habitation duties, data-protection, and AML/KYC.
 */

import { buildEntries, enOnlyBatch, type EntrySpec } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

const CORE_SPECS: readonly EntrySpec[] = [
  {
    id: 'compliance.gas_safety_certificate',
    en: 'gas safety certificate',
    def: 'Annual safety record for gas installations in rented premises.',
    cat: 'compliance',
    juris: ['GB'],
    cite: { jurisdiction: 'GB', statuteRef: 'Gas Safety (Installation and Use) Regulations', section: 'reg 36', year: 1998 },
    t: { sw: 'cheti cha usalama wa gesi' },
  },
  {
    id: 'compliance.epc',
    en: 'energy performance certificate',
    def: 'Statutory energy-efficiency rating required before letting residential property.',
    cat: 'compliance',
    juris: ['GB', 'FR', 'DE'],
    t: { fr: 'DPE', de: 'Energieausweis' },
    cite: { jurisdiction: 'GB', statuteRef: 'EPB Regs', section: 'reg 6', year: 2012 },
  },
  {
    id: 'compliance.fit_for_human_habitation',
    en: 'fit for human habitation',
    def: 'Statutory standard requiring rental premises to be habitable at inception and throughout term.',
    cat: 'compliance',
    juris: ['GB'],
    cite: { jurisdiction: 'GB', statuteRef: 'Homes (Fitness for Human Habitation) Act', section: 's.1', year: 2018 },
  },
  {
    id: 'compliance.hmo_licence',
    en: 'HMO licence',
    def: 'Licence for houses in multiple occupation meeting statutory thresholds.',
    cat: 'compliance',
    juris: ['GB'],
    cite: { jurisdiction: 'GB', statuteRef: 'Housing Act 2004', section: 'Part 2', year: 2004 },
  },
  {
    id: 'compliance.aml_kyc',
    en: 'AML/KYC checks',
    def: 'Anti-money-laundering and know-your-customer checks performed on prospective tenants or landlords.',
    cat: 'compliance',
    juris: ['GB', 'KE', 'US', 'DE', 'AE', 'IN', 'SG'],
    t: { ar: 'مكافحة غسل الأموال', fr: 'LAB/KYC', de: 'GwG-Prüfung' },
  },
  {
    id: 'compliance.data_protection_notice',
    en: 'data protection notice',
    def: 'Notice informing data subjects of processing purposes, retention, and rights.',
    cat: 'compliance',
    juris: ['GB', 'DE', 'FR', 'KE'],
    cite: { jurisdiction: 'GB', statuteRef: 'UK GDPR', section: 'Art 13', year: 2018 },
  },
  {
    id: 'compliance.dpo',
    en: 'data protection officer',
    def: 'Statutory officer responsible for GDPR/DPA compliance within an organisation.',
    cat: 'compliance',
    juris: ['GB', 'DE', 'FR', 'KE'],
    t: { fr: 'DPO', de: 'Datenschutzbeauftragter' },
  },
  {
    id: 'compliance.right_to_rent',
    en: 'right-to-rent check',
    def: 'Immigration-status check on prospective adult occupants before granting a tenancy.',
    cat: 'compliance',
    juris: ['GB'],
    cite: { jurisdiction: 'GB', statuteRef: 'Immigration Act 2014', section: 'Part 3', year: 2014 },
  },
  {
    id: 'compliance.fire_risk_assessment',
    en: 'fire risk assessment',
    def: 'Written appraisal of fire hazards in common parts of residential buildings.',
    cat: 'compliance',
    juris: ['GB'],
  },
  {
    id: 'compliance.legionella_risk',
    en: 'legionella risk assessment',
    def: 'Assessment of waterborne-pathogen risk in rental premises.',
    cat: 'compliance',
    juris: ['GB'],
  },
];

const EXTRA_ROWS: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>?]> = [
  ['compliance.eicr', 'electrical installation condition report', 'Safety test on fixed electrical installations.'],
  ['compliance.pat_test', 'portable appliance test', 'Annual safety test of plug-in appliances supplied by landlord.'],
  ['compliance.smoke_alarm', 'smoke alarm', 'Device required on every storey of a rented property.'],
  ['compliance.co_alarm', 'carbon-monoxide alarm', 'CO detector required where solid-fuel appliances are fitted.'],
  ['compliance.deposit_protection_certificate', 'deposit protection certificate', 'Evidence deposit is held in authorised scheme.'],
  ['compliance.tenancy_agreement_certification', 'tenancy agreement certification', 'Third-party certification of lease form.'],
  ['compliance.gdpr_dpa', 'Data Protection Act', 'UK statute implementing UK GDPR.'],
  ['compliance.pra_fca', 'FCA/PRA authorisation', 'Regulatory permission for firms handling client money.'],
  ['compliance.property_ombudsman', 'property ombudsman', 'Alternative dispute-resolution scheme for agents.'],
  ['compliance.redress_scheme', 'redress scheme', 'Statutory scheme for tenant/landlord complaints.'],
  ['compliance.landlord_licence', 'selective landlord licence', 'Local-authority licence scheme for landlords.'],
  ['compliance.additional_licence', 'additional HMO licence', 'Discretionary local-authority licence for smaller HMOs.'],
  ['compliance.article_4', 'Article 4 direction', 'Planning direction removing permitted-development rights.'],
  ['compliance.planning_permission', 'planning permission', 'Approval for development under planning law.'],
  ['compliance.change_of_use', 'change of use', 'Planning consent for switching a property between use classes.'],
  ['compliance.building_regulations', 'building regulations', 'Statutory standards for construction and alteration.'],
  ['compliance.asbestos_register', 'asbestos register', 'Record of asbestos-containing materials in a building.'],
  ['compliance.water_hygiene', 'water hygiene certificate', 'Evidence of water-system cleaning and testing.'],
  ['compliance.lift_loler', 'LOLER lift inspection', 'Periodic examination of lifting equipment.', ['GB']],
  ['compliance.accessibility_audit', 'accessibility audit', 'Evaluation against disability-access standards.'],
  ['compliance.bs5839', 'BS5839 fire alarm', 'Fire-alarm system compliant with British Standard 5839.', ['GB']],
  ['compliance.right_of_first_refusal', 'right of first refusal', 'Tenant right to buy the freehold before third-party sale.', ['GB']],
  ['compliance.ground_15_notice', 'ground 15 notice', 'AST possession ground notice.', ['GB']],
  ['compliance.improvement_notice', 'improvement notice', 'Statutory notice requiring remedial works.'],
  ['compliance.prohibition_order', 'prohibition order', 'Order restricting use of unsafe premises.'],
  ['compliance.emergency_prohibition', 'emergency prohibition order', 'Expedited prohibition where imminent risk present.'],
];

export const COMPLIANCE_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  ...buildEntries(CORE_SPECS),
  ...enOnlyBatch('compliance', ['GB', 'KE', 'US'], EXTRA_ROWS),
]);
