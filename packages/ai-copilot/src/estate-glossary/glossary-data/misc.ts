/**
 * Remaining categories — hr, insurance, marketing, procurement, for the
 * mining domain. These ship English-only; curated Swahili+English
 * mining content lives in `./mining.ts` and `./mining-rights.ts`
 * (shaft, drill, ore, assay, licence, gold-window, royalty, and the
 * Tanzanian-actor vocabulary).
 */

import { enOnlyBatch } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

export const HR_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'hr',
  ['TZ', 'KE', 'GH'],
  [
    ['hr.employee_contract', 'employee contract', 'Employment agreement setting terms of service.'],
    ['hr.probation_period', 'probation period', 'Initial period during which employment can be terminated at short notice.'],
    ['hr.performance_review', 'performance review', 'Formal appraisal of an employee’s work against objectives.'],
    ['hr.disciplinary_hearing', 'disciplinary hearing', 'Formal meeting to address misconduct allegations.'],
    ['hr.grievance', 'grievance', 'Formal complaint raised by an employee.'],
    ['hr.redundancy', 'redundancy', 'Dismissal on account of the operation requiring fewer employees.'],
    ['hr.statutory_sick_pay', 'statutory sick pay', 'Employer-paid sickness benefit under statute.'],
    ['hr.nssf', 'NSSF contributions', 'National Social Security Fund payroll contributions.', ['TZ']],
    ['hr.paye', 'PAYE', 'Employer tax withholding scheme on wages.'],
    ['hr.whistleblowing', 'whistleblowing', 'Protected disclosure of wrongdoing in the workplace.'],
    ['hr.contractor', 'independent contractor', 'Self-employed individual engaged on a contract-for-services basis.'],
    ['hr.mine_safety_induction', 'mine safety induction', 'Mandatory safety induction before a worker enters the operation.', ['TZ', 'GH', 'ZA']],
    ['hr.right_to_work', 'right to work', 'Immigration check verifying lawful employment.'],
    ['hr.secondment', 'secondment', 'Temporary assignment of an employee to another role or entity.'],
    ['hr.local_employment_quota', 'local-employment quota', 'The proportion of jobs that must go to nationals at each grade.', ['TZ', 'GH', 'NG']],
  ],
);

export const INSURANCE_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'insurance',
  ['TZ', 'KE', 'GH', 'ZA'],
  [
    ['insurance.operations_all_risk', 'mining operations all-risks', 'Policy covering plant, equipment, and physical-damage loss at the operation.'],
    ['insurance.plant_machinery', 'plant & machinery breakdown', 'Cover for sudden mechanical or electrical breakdown of plant.'],
    ['insurance.public_liability', 'public liability', 'Liability cover for injury or damage to third parties.'],
    ['insurance.employers_liability', 'employers liability', 'Liability cover for injury to employees (workman’s compensation).'],
    ['insurance.business_interruption', 'business interruption', 'Cover for lost margin when production is halted by an insured event.'],
    ['insurance.loss_of_production', 'loss of production cover', 'Cover for revenue lost while operations are suspended.'],
    ['insurance.professional_indemnity', 'professional indemnity', 'Cover against claims arising from professional services.'],
    ['insurance.cyber', 'cyber liability', 'Cover for data-breach and cyber-incident exposure.'],
    ['insurance.construction_all_risk', 'construction all-risks', 'Policy covering works during plant-construction phase.'],
    ['insurance.transit_cover', 'consignment transit cover', 'Cover for minerals in transit from mine to buyer or export.'],
    ['insurance.environmental_liability', 'environmental liability', 'Cover for pollution and rehabilitation liabilities.'],
    ['insurance.claim_excess', 'policy excess', 'Self-insured portion of a claim.'],
    ['insurance.subrogation', 'subrogation', 'Insurer right to pursue third parties for recovery after paying a claim.'],
    ['insurance.certificate_of_currency', 'certificate of currency', 'Evidence that a policy is in force on a date.'],
    ['insurance.broker_mandate', 'broker mandate', 'Authority appointing a broker to arrange cover.'],
  ],
);

export const MARKETING_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'marketing',
  ['TZ', 'KE', 'GH'],
  [
    ['marketing.listing', 'consignment listing', 'Advertised offer of a mineral consignment for sale.'],
    ['marketing.market_feed', 'market-price feed', 'Automated feed of reference prices (LBMA fix, spot) to the marketplace.'],
    ['marketing.cost_per_lead', 'cost per lead', 'Acquisition cost per buyer enquiry generated.'],
    ['marketing.conversion_rate', 'conversion rate', 'Proportion of enquiries converting to site visits or sales.'],
    ['marketing.tender_round', 'tender round', 'Scheduled competitive sale of consignments to invited buyers.'],
    ['marketing.virtual_tour', 'virtual gold-room tour', 'Interactive online walkthrough of the gold room and stock.'],
    ['marketing.hero_photo', 'hero photo', 'Lead marketing image for a consignment listing.'],
    ['marketing.assay_sheet', 'assay sheet', 'Published grade and purity data used to market a consignment.'],
    ['marketing.lead_source', 'lead source', 'Origin channel of a buyer enquiry.'],
    ['marketing.ppc', 'pay-per-click', 'Paid search channel charged per click.'],
    ['marketing.seo_snippet', 'SEO snippet', 'Metadata excerpt returned in search results.'],
    ['marketing.testimonial', 'buyer testimonial', 'Endorsement published with permission.'],
    ['marketing.brand_guideline', 'brand guideline', 'Rules governing brand use across channels.'],
    ['marketing.utm_campaign', 'UTM campaign', 'Tagged URL parameters for marketing attribution.'],
    ['marketing.retargeting', 'retargeting campaign', 'Ads served to buyers who viewed but did not transact.'],
  ],
);

export const PROCUREMENT_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'procurement',
  ['TZ', 'KE', 'GH'],
  [
    ['procurement.rfp', 'request for proposal', 'Solicitation inviting bids from potential suppliers.'],
    ['procurement.rfq', 'request for quotation', 'Solicitation inviting priced quotes.'],
    ['procurement.tender', 'tender', 'Formal competitive bidding exercise.'],
    ['procurement.sow', 'statement of work', 'Detailed scope, deliverables, and acceptance criteria.'],
    ['procurement.vendor_onboarding', 'vendor onboarding', 'Process for registering a supplier including KYC and insurance checks.'],
    ['procurement.preferred_supplier', 'preferred supplier', 'Contractor with agreed rates and priority for work orders.'],
    ['procurement.framework_agreement', 'framework agreement', 'Umbrella agreement enabling call-off contracts over time.'],
    ['procurement.call_off', 'call-off order', 'Individual order placed under a framework agreement.'],
    ['procurement.price_schedule', 'price schedule', 'Agreed rates document attached to a framework.'],
    ['procurement.performance_bond', 'performance bond', 'Guarantee securing contractor performance.'],
    ['procurement.retention_money', 'retention money', 'Sum withheld pending satisfactory completion.'],
    ['procurement.liquidated_damages', 'liquidated damages', 'Pre-agreed damages for delay or non-performance.'],
    ['procurement.force_majeure', 'force majeure', 'Contract clause excusing performance for defined extraordinary events.'],
    ['procurement.local_procurement', 'local-procurement plan', 'Filed plan committing the operation to source from local suppliers.', ['TZ', 'GH', 'NG']],
    ['procurement.conflict_of_interest', 'conflict of interest declaration', 'Supplier disclosure of competing interests.'],
  ],
);
