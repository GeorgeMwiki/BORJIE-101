/**
 * Reference Tab Recipe — `buyer_kyb_start`.
 *
 * Source of truth: spec §3 ("`buyer_kyb_start`"), spec §10 (PrefillForm
 * + citation_id alignment).
 *
 * Composes a Buyer KYB form with THREE field groups:
 *
 *   1. identity  — legal name, registration country, TIN.
 *   2. licence   — Tumemadini buyer licence, expiry, signed by.
 *   3. financial — annual purchase volume estimate, settlement bank.
 *
 * Authority tier 2 — Buyer KYB onboarding changes the operator's
 * counterparty graph and is therefore subject to owner + second-
 * authoriser approval per spec §5 (Tier 2 changes).
 *
 * Every regulatory-required field carries a `required_because`
 * citation contract pointing at the corpus passage that justifies its
 * inclusion. The recipe ships the citation IDs hardcoded (the corpus
 * runtime mounts these via `@borjie/compliance-pack` in Phase 2).
 */

import { actionRef, validateFormSchema } from '../composer.js';
import { regulatoryFields } from '../field-selectors/regulatory.js';
import { applyDataJoins } from '../field-selectors/data-join.js';
import { applyMasteryTier } from '../field-selectors/mastery-tier.js';
import { citationIdsFromGroups } from '../evidence.js';
import type {
  FormSchema,
  TabComposeContext,
  TabRecipe,
} from '../types.js';
import type {
  RegulatoryGroupSpec,
  RegulatoryRequirement,
} from '../field-selectors/regulatory.js';

const GROUPS: ReadonlyArray<RegulatoryGroupSpec> = [
  {
    id: 'identity',
    title_en: 'Buyer identity',
    title_sw: 'Utambulisho wa mnunuzi',
  },
  {
    id: 'licence',
    title_en: 'Buyer licence',
    title_sw: 'Leseni ya mnunuzi',
  },
  {
    id: 'financial',
    title_en: 'Financial profile',
    title_sw: 'Wasifu wa kifedha',
  },
];

const REQUIREMENTS: ReadonlyArray<RegulatoryRequirement> = [
  // -------- identity --------
  {
    field_id: 'legal_name',
    group_id: 'identity',
    kind: 'text',
    label_en: 'Legal entity name',
    label_sw: 'Jina la kisheria',
    help_en:
      'Name as it appears on the buyer\'s certificate of incorporation.',
    help_sw:
      'Jina kama linavyoonekana kwenye cheti cha usajili wa mnunuzi.',
    citation: {
      rule: 'Tumemadini Reg. 4.2 — buyer identification',
      citation_id: 'TUMEMADINI-4.2',
    },
    validate: { kind: 'min', payload: 2 },
  },
  {
    field_id: 'registration_country',
    group_id: 'identity',
    kind: 'enum',
    label_en: 'Country of registration',
    label_sw: 'Nchi ya usajili',
    help_en: 'ISO-3166 alpha-2 country code where the buyer is registered.',
    help_sw: 'Msimbo wa nchi (ISO-3166) ambapo mnunuzi amesajiliwa.',
    citation: {
      rule: 'OFAC sanctions screening — jurisdiction check',
      citation_id: 'OFAC-SCREEN-1',
    },
  },
  {
    field_id: 'tin_number',
    group_id: 'identity',
    kind: 'text',
    label_en: 'Tax Identification Number (TIN)',
    label_sw: 'Nambari ya Utambulisho wa Kodi (TIN)',
    help_en: 'TRA-issued TIN. Format: 9 digits.',
    help_sw: 'TIN iliyotolewa na TRA. Muundo: tarakimu 9.',
    citation: {
      rule: 'TRA Act §29 — counterparty TIN capture',
      citation_id: 'TRA-29',
    },
    validate: { kind: 'regex', payload: '^\\d{9}$' },
  },
  // -------- licence --------
  {
    field_id: 'licence_number',
    group_id: 'licence',
    kind: 'text',
    label_en: 'Tumemadini buyer licence number',
    label_sw: 'Nambari ya leseni ya mnunuzi (Tumemadini)',
    help_en: 'The licence number issued by the Mining Commission.',
    help_sw: 'Nambari ya leseni iliyotolewa na Tume ya Madini.',
    citation: {
      rule: 'Tumemadini Reg. 4.5 — buyer licence reference',
      citation_id: 'TUMEMADINI-4.5',
    },
  },
  {
    field_id: 'licence_expiry',
    group_id: 'licence',
    kind: 'date',
    label_en: 'Licence expiry date',
    label_sw: 'Tarehe ya kuisha kwa leseni',
    help_en: 'Buyer cannot transact past this date without renewal.',
    help_sw: 'Mnunuzi hawezi kufanya biashara baada ya tarehe hii bila kufanya upyaisho.',
    citation: {
      rule: 'Tumemadini Reg. 4.5 — buyer licence expiry',
      citation_id: 'TUMEMADINI-4.5',
    },
  },
  // -------- financial --------
  {
    field_id: 'annual_volume_estimate',
    group_id: 'financial',
    kind: 'currency',
    label_en: 'Estimated annual purchase volume (USD)',
    label_sw: 'Kiasi cha makadirio ya mwaka ya ununuzi (USD)',
    help_en: 'Used to set FX hedge thresholds. Estimate is binding for 90 days.',
    help_sw:
      'Inatumika kuweka vizingiti vya hedi ya FX. Makadirio ni ya lazima kwa siku 90.',
    citation: {
      rule: 'Borjie FX risk threshold policy §3.1',
      citation_id: 'BORJIE-FX-3.1',
    },
  },
  {
    field_id: 'settlement_bank',
    group_id: 'financial',
    kind: 'text',
    label_en: 'Settlement bank',
    label_sw: 'Benki ya malipo',
    help_en: 'SWIFT/BIC of the buyer\'s settlement bank.',
    help_sw: 'SWIFT/BIC ya benki ya malipo ya mnunuzi.',
    citation: {
      rule: 'AML KYB §7 — settlement channel disclosure',
      citation_id: 'AML-KYB-7',
    },
  },
];

const RECIPE_ID = 'buyer_kyb_start';
const VERSION = 1;

async function compose(ctx: TabComposeContext): Promise<FormSchema> {
  const fromRegulatory = regulatoryFields({
    groups: GROUPS,
    requirements: REQUIREMENTS,
  });
  const groups = await fromRegulatory(ctx);
  const joined = await applyDataJoins({
    rules: [
      { field_id: 'tin_number', join_key: 'buyer.tin_number' },
      { field_id: 'legal_name', join_key: 'buyer.legal_name' },
      { field_id: 'registration_country', join_key: 'buyer.country' },
    ],
  })(groups, ctx);
  const tiered = await applyMasteryTier({
    noviceFieldsPerGroup: 2,
  })(joined, ctx);
  const submit_action = actionRef(RECIPE_ID);
  const evidence_ids = citationIdsFromGroups(tiered);
  const schema: FormSchema = {
    title_en: 'New buyer onboarding (KYB)',
    title_sw: 'Usajili wa mnunuzi mpya (KYB)',
    groups: tiered,
    submit_action,
    evidence_ids,
  };
  return validateFormSchema(schema);
}

export const buyerKybStartRecipe: TabRecipe = {
  id: RECIPE_ID,
  intent: 'BuyerKYBStart',
  version: VERSION,
  status: 'live',
  compose,
  telemetry_key: 'ui.recipe.buyer_kyb_start',
  brand: 'borjie',
  authority_tier: 2,
};
