/**
 * Compliance-related glossary (mining domain). Covers environmental
 * (EIA/NEMC), tailings and mine safety, mercury-free / Minamata,
 * mine-closure and rehabilitation, data-protection, and AML/KYC for
 * mineral trade.
 */

import { buildEntries, enOnlyBatch, type EntrySpec } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

const CORE_SPECS: readonly EntrySpec[] = [
  {
    id: 'compliance.environmental_certificate',
    en: 'environmental certificate (EIA)',
    def: 'NEMC-issued certificate confirming an approved environmental impact assessment before mining may begin.',
    cat: 'compliance',
    juris: ['TZ'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Environmental Management Act', section: 's.81', year: 2004 },
    t: { sw: 'cheti cha mazingira' },
  },
  {
    id: 'compliance.tailings_safety',
    en: 'tailings storage facility safety',
    def: 'Statutory inspection and certification regime for the stability and water management of a tailings dam (TSF).',
    cat: 'compliance',
    juris: ['TZ', 'GH', 'ZA'],
    t: { sw: 'usalama wa bwawa la mabaki' },
  },
  {
    id: 'compliance.mine_safety',
    en: 'mine occupational safety',
    def: 'Statutory standard requiring a mine to protect the health and safety of its workforce at all times.',
    cat: 'compliance',
    juris: ['TZ', 'GH', 'ZA'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Mining (Safe Working and Occupational Health) Regulations', section: 'reg 5', year: 2010 },
  },
  {
    id: 'compliance.mining_licence',
    en: 'mining licence in good standing',
    def: 'A mineral right that is current on rent, royalty, reporting, and conditions and therefore not liable to suspension.',
    cat: 'compliance',
    juris: ['TZ'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Mining Act', section: 's.43', year: 2010 },
  },
  {
    id: 'compliance.aml_kyc',
    en: 'AML/KYC checks',
    def: 'Anti-money-laundering and know-your-customer checks performed on prospective mineral buyers or counterparties.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'US', 'DE', 'AE', 'IN', 'SG'],
    t: { ar: 'مكافحة غسل الأموال', fr: 'LAB/KYC', de: 'GwG-Prüfung' },
  },
  {
    id: 'compliance.data_protection_notice',
    en: 'data protection notice',
    def: 'Notice informing data subjects of processing purposes, retention, and rights under the PDPA 2022.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'DE', 'FR'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Personal Data Protection Act', section: 's.23', year: 2022 },
  },
  {
    id: 'compliance.dpo',
    en: 'data protection officer',
    def: 'Statutory officer responsible for PDPA/GDPR compliance within an organisation.',
    cat: 'compliance',
    juris: ['TZ', 'KE', 'DE', 'FR'],
    t: { fr: 'DPO', de: 'Datenschutzbeauftragter' },
  },
  {
    id: 'compliance.local_content_check',
    en: 'local-content compliance check',
    def: 'Verification that indigenous shareholding, employment, and procurement quotas are met before grant or renewal.',
    cat: 'compliance',
    juris: ['TZ', 'GH', 'NG'],
    cite: { jurisdiction: 'TZ', statuteRef: 'Mining (Local Content) Regulations', section: 'reg 8', year: 2018 },
  },
  {
    id: 'compliance.mercury_free',
    en: 'mercury-free processing',
    def: 'Gold recovery without mercury (e.g. gravity or borax) in line with the Minamata Convention.',
    cat: 'compliance',
    juris: ['TZ', 'GH'],
    t: { sw: 'uchenjuaji bila zebaki' },
  },
];

const EXTRA_ROWS: ReadonlyArray<readonly [string, string, string, ReadonlyArray<string>?]> = [
  ['compliance.minamata', 'Minamata Convention', 'International treaty phasing down mercury use in artisanal gold mining.'],
  ['compliance.dust_monitoring', 'dust & emissions monitoring', 'Periodic measurement of airborne dust and emissions against limits.'],
  ['compliance.water_discharge_permit', 'water discharge permit', 'Authorisation to discharge process or mine water to the environment.'],
  ['compliance.cyanide_code', 'cyanide management code', 'Voluntary code governing safe use of cyanide in gold leaching.'],
  ['compliance.rehabilitation_bond', 'rehabilitation bond', 'Financial guarantee posted to fund site rehabilitation if the operator defaults.'],
  ['compliance.mine_closure_plan', 'mine closure plan', 'Approved plan for safe decommissioning and rehabilitation at end of mine life.'],
  ['compliance.osh_inspection', 'OSH inspection', 'Occupational safety and health inspection of the mine workings and plant.'],
  ['compliance.blasting_licence', 'blasting licence', 'Permit authorising the storage and use of explosives.'],
  ['compliance.explosives_magazine', 'explosives magazine certificate', 'Certificate for a compliant explosives storage facility.'],
  ['compliance.ventilation_compliance', 'ventilation compliance', 'Verification that underground airflow meets statutory minimums.'],
  ['compliance.ground_control', 'ground-control plan', 'Plan managing rock-mass stability and support in workings.'],
  ['compliance.fire_risk_assessment', 'fire risk assessment', 'Written appraisal of fire hazards across plant and stores.'],
  ['compliance.eicr', 'electrical installation condition report', 'Safety test on fixed electrical installations at the plant.'],
  ['compliance.pat_test', 'portable appliance test', 'Safety test of plug-in appliances used on site.'],
  ['compliance.smoke_alarm', 'smoke detection', 'Detection required across plant control rooms and offices.'],
  ['compliance.co_alarm', 'gas detection', 'Gas detector required where combustion or confined spaces exist.'],
  ['compliance.due_diligence', 'supply-chain due diligence', 'The OECD five-step process for responsible mineral sourcing.', ['TZ', 'CD', 'RW']],
  ['compliance.conflict_free', 'conflict-free certification', 'Certification that minerals did not finance armed conflict (OECD, ICGLR/RCM).', ['TZ', 'CD', 'RW']],
  ['compliance.traceability_3t', '3T traceability', 'Chain-of-custody tracking for tin, tantalum, and tungsten to certify conflict-free origin.', ['TZ', 'CD', 'RW']],
  ['compliance.export_compliance', 'export compliance', 'Verification that an export consignment has paid royalty, clearing fee, and holds a permit.'],
  ['compliance.asm_formalisation', 'ASM formalisation', 'Bringing artisanal and small-scale miners into the licensed, taxed economy.', ['TZ', 'GH']],
  ['compliance.community_dev_agreement', 'community development agreement', 'Mandatory agreement committing benefits to host communities.', ['TZ', 'GH']],
  ['compliance.grievance_mechanism', 'community grievance mechanism', 'Formal channel for host-community complaints about mine impacts.'],
  ['compliance.water_hygiene', 'potable-water certificate', 'Evidence of camp drinking-water cleaning and testing.'],
  ['compliance.accessibility_audit', 'accessibility audit', 'Evaluation of site facilities against disability-access standards.'],
  ['compliance.improvement_notice', 'improvement notice', 'Statutory notice requiring remedial works at the operation.'],
  ['compliance.prohibition_order', 'stop-work order', 'Order restricting use of unsafe workings or plant.'],
  ['compliance.emergency_prohibition', 'emergency stop-work order', 'Expedited stop-work where imminent risk is present.'],
];

export const COMPLIANCE_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  ...buildEntries(CORE_SPECS),
  ...enOnlyBatch('compliance', ['TZ', 'KE', 'GH'], EXTRA_ROWS),
]);
