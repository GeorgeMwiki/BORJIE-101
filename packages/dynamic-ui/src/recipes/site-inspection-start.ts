/**
 * Reference Tab Recipe — `site_inspection_start`.
 *
 * Source of truth: spec §3 — second example bound to `SiteInspectionStart`.
 *
 * Composes a Site Inspection form with TWO field groups:
 *
 *   1. site_selector — pick the parcel, inspector identity, date.
 *   2. observation    — narrative + photographic evidence, compliance flag.
 *
 * Authority tier 1 — Adding/removing fields here only triggers an owner
 * approval, not a second-authoriser sign-off, because site inspections
 * do not touch the operator's counterparty graph or settlement rails.
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
    id: 'site_selector',
    title_en: 'Site selection',
    title_sw: 'Uchaguzi wa eneo',
  },
  {
    id: 'observation',
    title_en: 'Site observation',
    title_sw: 'Uchunguzi wa eneo',
  },
];

const REQUIREMENTS: ReadonlyArray<RegulatoryRequirement> = [
  // -------- site_selector --------
  {
    field_id: 'parcel_ref',
    group_id: 'site_selector',
    kind: 'text',
    label_en: 'Parcel reference',
    label_sw: 'Marejeo ya kiwanja',
    help_en: 'Parcel ID as recorded in the Tumemadini cadastre.',
    help_sw: 'Kitambulisho cha kiwanja kama kilivyorekodiwa katika rejista ya Tumemadini.',
    citation: {
      rule: 'Tumemadini cadastre §2 — parcel reference',
      citation_id: 'TUMEMADINI-2.1',
    },
  },
  {
    field_id: 'inspector_id',
    group_id: 'site_selector',
    kind: 'text',
    label_en: 'Inspector ID',
    label_sw: 'Kitambulisho cha mkaguzi',
    help_en: 'Borjie inspector ID. Pre-filled from the operator session.',
    help_sw: 'Kitambulisho cha mkaguzi wa Borjie. Hujazwa kutoka kwenye kikao.',
    citation: {
      rule: 'Borjie audit policy §1 — inspector identity',
      citation_id: 'BORJIE-AUDIT-1',
    },
  },
  {
    field_id: 'visit_date',
    group_id: 'site_selector',
    kind: 'date',
    label_en: 'Visit date',
    label_sw: 'Tarehe ya ziara',
    help_en: 'Calendar date of the on-site visit.',
    help_sw: 'Tarehe ya ziara ya eneo.',
    citation: {
      rule: 'Borjie audit policy §2 — visit logging',
      citation_id: 'BORJIE-AUDIT-2',
    },
  },
  // -------- observation --------
  {
    field_id: 'observations_narrative',
    group_id: 'observation',
    kind: 'multiline',
    label_en: 'Narrative observations',
    label_sw: 'Maelezo ya uchunguzi',
    help_en:
      'Free-text observations. The brain extracts compliance flags from this field.',
    help_sw:
      'Maelezo ya bure. Akili itatoa alama za kufuatilia sheria kutoka hapa.',
    citation: {
      rule: 'Tumemadini Reg. 7.3 — site inspection narrative',
      citation_id: 'TUMEMADINI-7.3',
    },
  },
  {
    field_id: 'compliance_flag',
    group_id: 'observation',
    kind: 'enum',
    label_en: 'Compliance flag',
    label_sw: 'Alama ya kufuatilia sheria',
    help_en: 'compliant | warning | violation',
    help_sw: 'inafuata | onyo | ukiukaji',
    citation: {
      rule: 'Tumemadini Reg. 7.4 — inspector verdict',
      citation_id: 'TUMEMADINI-7.4',
    },
    validate: {
      kind: 'enum',
      payload: ['compliant', 'warning', 'violation'],
    },
  },
];

const RECIPE_ID = 'site_inspection_start';
const VERSION = 1;

async function compose(ctx: TabComposeContext): Promise<FormSchema> {
  const fromRegulatory = regulatoryFields({
    groups: GROUPS,
    requirements: REQUIREMENTS,
  });
  const groups = await fromRegulatory(ctx);
  const joined = await applyDataJoins({
    rules: [
      { field_id: 'inspector_id', join_key: 'inspector.id' },
      { field_id: 'parcel_ref', join_key: 'parcel.ref' },
    ],
  })(groups, ctx);
  const tiered = await applyMasteryTier({
    noviceFieldsPerGroup: 3,
  })(joined, ctx);
  const submit_action = actionRef(RECIPE_ID);
  const evidence_ids = citationIdsFromGroups(tiered);
  const schema: FormSchema = {
    title_en: 'Site inspection',
    title_sw: 'Uchunguzi wa eneo',
    groups: tiered,
    submit_action,
    evidence_ids,
  };
  return validateFormSchema(schema);
}

export const siteInspectionStartRecipe: TabRecipe = {
  id: RECIPE_ID,
  intent: 'SiteInspectionStart',
  version: VERSION,
  status: 'live',
  compose,
  telemetry_key: 'ui.recipe.site_inspection_start',
  brand: 'borjie',
  authority_tier: 1,
};
