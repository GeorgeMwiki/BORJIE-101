/**
 * Remaining categories — hr, insurance, marketing, procurement. v1 is
 * English-only per spec; translations are a TODO-L18N follow-up and
 * deliberately not blocking the module shipping.
 */

import { enOnlyBatch } from './helpers.js';
import type { GlossaryEntry } from '../types.js';

export const HR_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'hr',
  ['GB', 'KE', 'US'],
  [
    ['hr.employee_contract', 'employee contract', 'Employment agreement setting terms of service.'],
    ['hr.probation_period', 'probation period', 'Initial period during which employment can be terminated at short notice.'],
    ['hr.performance_review', 'performance review', 'Formal appraisal of an employee’s work against objectives.'],
    ['hr.disciplinary_hearing', 'disciplinary hearing', 'Formal meeting to address misconduct allegations.'],
    ['hr.grievance', 'grievance', 'Formal complaint raised by an employee.'],
    ['hr.redundancy', 'redundancy', 'Dismissal on account of business requiring fewer employees.'],
    ['hr.statutory_sick_pay', 'statutory sick pay', 'Employer-paid sickness benefit under statute.'],
    ['hr.national_insurance', 'national insurance contributions', 'Payroll social-insurance levy.'],
    ['hr.paye', 'PAYE', 'Employer tax withholding scheme.'],
    ['hr.whistleblowing', 'whistleblowing', 'Protected disclosure of wrongdoing in the workplace.'],
    ['hr.contractor', 'independent contractor', 'Self-employed individual engaged on a contract-for-services basis.'],
    ['hr.ir35', 'IR35 determination', 'Status assessment for off-payroll engagements.', ['GB']],
    ['hr.right_to_work', 'right to work', 'Immigration check verifying lawful employment.'],
    ['hr.secondment', 'secondment', 'Temporary assignment of an employee to another role or entity.'],
    ['hr.dbs_check', 'DBS check', 'Criminal-record background check.', ['GB']],
  ],
);

export const INSURANCE_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'insurance',
  ['GB', 'KE', 'US', 'DE'],
  [
    ['insurance.landlord_policy', 'landlord insurance policy', 'Policy covering buildings, loss of rent, and liability for let property.'],
    ['insurance.contents_policy', 'contents insurance', 'Policy covering tenant possessions inside the premises.'],
    ['insurance.public_liability', 'public liability', 'Liability cover for injury or damage to third parties.'],
    ['insurance.employers_liability', 'employers liability', 'Liability cover for injury to employees.'],
    ['insurance.rent_guarantee', 'rent guarantee insurance', 'Policy protecting landlord income when tenant defaults.'],
    ['insurance.loss_of_rent', 'loss of rent cover', 'Cover for rental income lost while premises uninhabitable.'],
    ['insurance.professional_indemnity', 'professional indemnity', 'Cover against claims arising from professional services.'],
    ['insurance.cyber', 'cyber liability', 'Cover for data-breach and cyber-incident exposure.'],
    ['insurance.construction_all_risk', 'construction all-risks', 'Policy covering works during construction phase.'],
    ['insurance.flood_cover', 'flood cover', 'Optional cover for flood-related damage.'],
    ['insurance.subsidence', 'subsidence cover', 'Cover for damage arising from ground movement.'],
    ['insurance.claim_excess', 'policy excess', 'Self-insured portion of a claim.'],
    ['insurance.subrogation', 'subrogation', 'Insurer right to pursue third parties for recovery after paying a claim.'],
    ['insurance.certificate_of_currency', 'certificate of currency', 'Evidence that a policy is in force on a date.'],
    ['insurance.broker_mandate', 'broker mandate', 'Authority appointing a broker to arrange cover.'],
  ],
);

export const MARKETING_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'marketing',
  ['GB', 'KE', 'US'],
  [
    ['marketing.listing', 'listing', 'Advertised offer of a property to let.'],
    ['marketing.portal_feed', 'portal feed', 'Automated property data feed to portals (Rightmove, Property24).'],
    ['marketing.cost_per_lead', 'cost per lead', 'Acquisition cost per enquiry generated.'],
    ['marketing.conversion_rate', 'conversion rate', 'Proportion of enquiries converting to viewings or lets.'],
    ['marketing.open_house', 'open house', 'Scheduled group viewing of a vacant property.'],
    ['marketing.virtual_tour', 'virtual tour', 'Interactive online walkthrough of a property.'],
    ['marketing.hero_photo', 'hero photo', 'Lead marketing image for a listing.'],
    ['marketing.staging', 'staging', 'Temporary furnishing used to enhance a viewing.'],
    ['marketing.lead_source', 'lead source', 'Origin channel of an enquiry.'],
    ['marketing.ppc', 'pay-per-click', 'Paid search channel charged per click.'],
    ['marketing.seo_snippet', 'SEO snippet', 'Metadata excerpt returned in search results.'],
    ['marketing.testimonial', 'tenant testimonial', 'Endorsement published with permission.'],
    ['marketing.brand_guideline', 'brand guideline', 'Rules governing brand use across channels.'],
    ['marketing.utm_campaign', 'UTM campaign', 'Tagged URL parameters for marketing attribution.'],
    ['marketing.retargeting', 'retargeting campaign', 'Ads served to users who viewed but did not convert.'],
  ],
);

export const PROCUREMENT_ENTRIES: readonly GlossaryEntry[] = enOnlyBatch(
  'procurement',
  ['GB', 'KE', 'US'],
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
    ['procurement.modern_slavery', 'modern slavery statement', 'Supplier declaration against forced labour.', ['GB']],
    ['procurement.conflict_of_interest', 'conflict of interest declaration', 'Supplier disclosure of competing interests.'],
  ],
);
