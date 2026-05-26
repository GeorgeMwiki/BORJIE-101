/**
 * The 74 reserved vertical-profile definitions (Wave VP-1).
 *
 * Per Docs/DESIGN/UNIVERSAL_VERTICAL_PROFILES_SPEC.md §5 the registry
 * ships 1 live profile (mining-tz, see `@borjie/vertical-profile-mining-tz`)
 * plus 74 reserved profiles covering eight verticals across all
 * markets on the published roadmap.
 *
 * Each reserved profile is a fully-formed definition row — it satisfies
 * the schema, carries ≥6 entities (inherited from the vertical
 * template), carries ≥1 regulator binding, and ≥1 provenance citation
 * (from `citations.ts`). `implementationPackage` is null so the CHECK
 * constraint in migration 0057 holds.
 *
 * @module @borjie/vertical-profiles/seeds/reserved-profiles
 */

import {
  VERTICAL_ANCHORS,
} from './citations.js';
import { VERTICAL_ENTITY_TEMPLATES } from './entity-templates.js';
import type {
  Vertical,
  VerticalProfileDefinition,
  RegulatorBinding,
} from '../types.js';

interface ReservedSpec {
  readonly vertical: Vertical;
  readonly region: string;
  readonly displayName: string;
  readonly regulators: ReadonlyArray<RegulatorBinding>;
  readonly summary: string;
}

function mkReserved(spec: ReservedSpec): VerticalProfileDefinition {
  const id = `${spec.vertical}-${spec.region}`;
  return Object.freeze({
    id,
    vertical: spec.vertical,
    region: spec.region,
    displayName: spec.displayName,
    status: 'reserved' as const,
    description: spec.summary,
    entities: VERTICAL_ENTITY_TEMPLATES[spec.vertical],
    glossary: [],
    regulatorBindings: spec.regulators,
    capabilitySeeds: [],
    provenance: VERTICAL_ANCHORS[spec.vertical] ?? [],
    implementationPackage: null,
  });
}

function rb(regulatorId: string, filingKinds: ReadonlyArray<string>): RegulatorBinding {
  return Object.freeze({ regulatorId, filingKinds });
}

// ---------------------------------------------------------------------------
// Mining (10 reserved)
// ---------------------------------------------------------------------------

const MINING: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'mining',
    region: 'ke',
    displayName: 'Mining (Kenya)',
    summary: 'Reserved profile — Kenyan mining sector. Regulators: KRA (Kenya Revenue Authority), State Department for Mining (SDM), NEMA Kenya, Central Bank of Kenya. Activates when a Kenyan tenant signs up.',
    regulators: [
      rb('ke-kra', ['vat-monthly', 'corporate-income', 'paye-monthly']),
      rb('ke-sdm', ['royalty-monthly', 'mineral-rights-renewal']),
      rb('ke-nema', ['eia', 'environmental-audit']),
      rb('ke-cbk', ['fx-quarterly']),
    ],
  },
  {
    vertical: 'mining',
    region: 'ng',
    displayName: 'Mining (Nigeria)',
    summary: 'Reserved profile — Nigerian mining sector. Regulators: Mining Cadastre Office (MCO), Federal Inland Revenue Service (FIRS), NESREA, Central Bank of Nigeria. Activates when a Nigerian tenant signs up.',
    regulators: [
      rb('ng-mco', ['mineral-title-renewal', 'royalty-monthly']),
      rb('ng-firs', ['vat-monthly', 'companies-income-tax']),
      rb('ng-nesrea', ['eia', 'compliance-audit']),
      rb('ng-cbn', ['fx-export-proceeds']),
    ],
  },
  {
    vertical: 'mining',
    region: 'za',
    displayName: 'Mining (South Africa)',
    summary: 'Reserved profile — South African mining sector. Regulators: Department of Mineral Resources (DMR), South African Revenue Service (SARS), Department of Forestry, Fisheries and Environment (DFFE).',
    regulators: [
      rb('za-dmr', ['social-and-labour-plan', 'royalty-annual', 'mining-right-renewal']),
      rb('za-sars', ['vat-monthly', 'mineral-royalty', 'paye-monthly']),
      rb('za-dffe', ['eia', 'water-use-licence']),
    ],
  },
  {
    vertical: 'mining',
    region: 'au',
    displayName: 'Mining (Australia)',
    summary: 'Reserved profile — Australian mining sector. Regulators: state mines departments (e.g. NSW DRG, WA DMIRS), Australian Taxation Office, DAWE.',
    regulators: [
      rb('au-dmirs', ['royalty-quarterly', 'tenement-rent']),
      rb('au-ato', ['bas-quarterly', 'corporate-income', 'mrrt-historical']),
      rb('au-dawe', ['epbc-eia', 'water-trigger']),
    ],
  },
  {
    vertical: 'mining',
    region: 'cl',
    displayName: 'Mining (Chile)',
    summary: 'Reserved profile — Chilean mining sector. Regulators: Sernageomin (mining safety + production), SII (tax), SMA (environment).',
    regulators: [
      rb('cl-sernageomin', ['production-statistics-monthly', 'safety-report']),
      rb('cl-sii', ['iva-monthly', 'specific-mining-tax']),
      rb('cl-sma', ['rca-compliance', 'eia']),
    ],
  },
  {
    vertical: 'mining',
    region: 'pe',
    displayName: 'Mining (Peru)',
    summary: 'Reserved profile — Peruvian mining sector. Regulators: MINEM (Ministry of Energy + Mines), SUNAT (tax), OEFA (environment).',
    regulators: [
      rb('pe-minem', ['production-statistics', 'concession-fee']),
      rb('pe-sunat', ['igv-monthly', 'mining-royalty']),
      rb('pe-oefa', ['environmental-audit', 'instrumental-monitoring']),
    ],
  },
  {
    vertical: 'mining',
    region: 'ca',
    displayName: 'Mining (Canada)',
    summary: 'Reserved profile — Canadian mining sector. Regulators: provincial mines ministries (e.g. ON MNDM), CRA, ECCC.',
    regulators: [
      rb('ca-mndm', ['claim-renewal', 'assessment-work']),
      rb('ca-cra', ['gst-hst-monthly', 'corporate-income', 'flow-through-shares']),
      rb('ca-eccc', ['environmental-effects-monitoring']),
    ],
  },
  {
    vertical: 'mining',
    region: 'ru',
    displayName: 'Mining (Russia)',
    summary: 'Reserved profile — Russian mining sector. Regulators: Rosnedra (subsoil), FNS (tax), Rosprirodnadzor (environment).',
    regulators: [
      rb('ru-rosnedra', ['mining-licence-renewal', 'production-statistics']),
      rb('ru-fns', ['vat-quarterly', 'mineral-extraction-tax']),
      rb('ru-rosprirodnadzor', ['environmental-impact', 'waste-disposal']),
    ],
  },
  {
    vertical: 'mining',
    region: 'id',
    displayName: 'Mining (Indonesia)',
    summary: 'Reserved profile — Indonesian mining sector. Regulators: ESDM (Mineral + Energy), DGT (tax), KLHK (environment).',
    regulators: [
      rb('id-esdm', ['iup-renewal', 'production-statistics-monthly']),
      rb('id-djp', ['vat-monthly', 'mining-royalty', 'corporate-income']),
      rb('id-klhk', ['amdal-eia', 'reclamation-bond']),
    ],
  },
  {
    vertical: 'mining',
    region: 'ph',
    displayName: 'Mining (Philippines)',
    summary: 'Reserved profile — Philippine mining sector. Regulators: MGB (Mines + Geosciences Bureau), BIR (tax), DENR-EMB (environment).',
    regulators: [
      rb('ph-mgb', ['mineral-production-statistics', 'mining-tax']),
      rb('ph-bir', ['vat-quarterly', 'excise-tax']),
      rb('ph-denr-emb', ['eia', 'ecc-compliance']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Agri (8 reserved — agri-tz is also reserved at this wave)
// ---------------------------------------------------------------------------

const AGRI: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'agri',
    region: 'tz',
    displayName: 'Agriculture (Tanzania)',
    summary: 'Reserved profile — Tanzanian agriculture sector. Regulators: TRA, Ministry of Agriculture (MoA), Tanzania Food + Drug Authority (TFDA), TARI.',
    regulators: [
      rb('tz-tra', ['vat-monthly', 'corporate-income']),
      rb('tz-moa', ['export-permit', 'harvest-statistics']),
      rb('tz-tfda', ['food-safety-renewal']),
    ],
  },
  {
    vertical: 'agri',
    region: 'ke',
    displayName: 'Agriculture (Kenya)',
    summary: 'Reserved profile — Kenyan agriculture sector. Regulators: KRA, MoALF (Ministry of Agriculture, Livestock + Fisheries), KEPHIS (plant health).',
    regulators: [
      rb('ke-kra', ['vat-monthly', 'corporate-income']),
      rb('ke-moalf', ['export-permit', 'subsidy-claim']),
      rb('ke-kephis', ['phytosanitary-certificate']),
    ],
  },
  {
    vertical: 'agri',
    region: 'ng',
    displayName: 'Agriculture (Nigeria)',
    summary: 'Reserved profile — Nigerian agriculture sector. Regulators: FIRS, Federal Ministry of Agriculture + Rural Development (FMARD), NAFDAC.',
    regulators: [
      rb('ng-firs', ['vat-monthly', 'companies-income-tax']),
      rb('ng-fmard', ['export-permit', 'subsidy-claim']),
      rb('ng-nafdac', ['food-product-registration']),
    ],
  },
  {
    vertical: 'agri',
    region: 'et',
    displayName: 'Agriculture (Ethiopia)',
    summary: 'Reserved profile — Ethiopian agriculture sector. Regulators: ERCA (revenue + customs), Ministry of Agriculture (MoA), AAERA.',
    regulators: [
      rb('et-erca', ['vat-monthly', 'corporate-income']),
      rb('et-moa', ['export-permit']),
      rb('et-aaera', ['eia']),
    ],
  },
  {
    vertical: 'agri',
    region: 'br',
    displayName: 'Agriculture (Brazil)',
    summary: 'Reserved profile — Brazilian agriculture sector. Regulators: Receita Federal, Ministério da Agricultura (MAPA), Embrapa.',
    regulators: [
      rb('br-rfb', ['icms-monthly', 'corporate-income', 'pis-cofins']),
      rb('br-mapa', ['phytosanitary-permit', 'export-certificate']),
      rb('br-embrapa', ['variety-registration']),
    ],
  },
  {
    vertical: 'agri',
    region: 'in',
    displayName: 'Agriculture (India)',
    summary: 'Reserved profile — Indian agriculture sector. Regulators: GSTN, Ministry of Agriculture + Farmers Welfare (MoAFW), FSSAI.',
    regulators: [
      rb('in-gstn', ['gst-monthly', 'corporate-income']),
      rb('in-moafw', ['msp-scheme', 'export-permit']),
      rb('in-fssai', ['food-safety-licence']),
    ],
  },
  {
    vertical: 'agri',
    region: 'id',
    displayName: 'Agriculture (Indonesia)',
    summary: 'Reserved profile — Indonesian agriculture sector. Regulators: DJP (tax), Kementan (Ministry of Agriculture), BPOM.',
    regulators: [
      rb('id-djp', ['vat-monthly', 'corporate-income']),
      rb('id-kementan', ['export-permit']),
      rb('id-bpom', ['food-product-registration']),
    ],
  },
  {
    vertical: 'agri',
    region: 'vn',
    displayName: 'Agriculture (Vietnam)',
    summary: 'Reserved profile — Vietnamese agriculture sector. Regulators: GDT (tax), MARD, VFA (Vietnam Food Administration).',
    regulators: [
      rb('vn-gdt', ['vat-monthly', 'corporate-income']),
      rb('vn-mard', ['phytosanitary', 'export-quota']),
      rb('vn-vfa', ['food-safety-certificate']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Oil & Gas (9 reserved)
// ---------------------------------------------------------------------------

const OILGAS: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'oilgas',
    region: 'ng',
    displayName: 'Oil & Gas (Nigeria)',
    summary: 'Reserved profile — Nigerian upstream + midstream oil + gas. Regulators: NUPRC (upstream), NMDPRA (midstream + downstream), FIRS.',
    regulators: [
      rb('ng-nuprc', ['production-monthly', 'lease-rent', 'gas-flare-charge']),
      rb('ng-nmdpra', ['refinery-licence', 'distribution-permit']),
      rb('ng-firs', ['hydrocarbon-tax', 'companies-income-tax']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'ao',
    displayName: 'Oil & Gas (Angola)',
    summary: 'Reserved profile — Angolan upstream petroleum. Regulators: ANPG (concessionaire), MINFIN.',
    regulators: [
      rb('ao-anpg', ['production-monthly', 'cost-recovery']),
      rb('ao-minfin', ['petroleum-income-tax', 'training-levy']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'uk',
    displayName: 'Oil & Gas (United Kingdom)',
    summary: 'Reserved profile — UK upstream petroleum (UKCS). Regulators: NSTA, HMRC, OPRED.',
    regulators: [
      rb('gb-nsta', ['production-monthly', 'licence-renewal', 'decommissioning-plan']),
      rb('gb-hmrc', ['petroleum-revenue-tax', 'supplementary-charge', 'vat-quarterly']),
      rb('gb-opred', ['environmental-statement', 'discharge-permit']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'no',
    displayName: 'Oil & Gas (Norway)',
    summary: 'Reserved profile — Norwegian Continental Shelf petroleum. Regulators: NPD (Oljedirektoratet), Skatteetaten, Miljødirektoratet.',
    regulators: [
      rb('no-npd', ['production-monthly', 'plan-for-development-and-operation']),
      rb('no-skatteetaten', ['petroleum-tax', 'special-tax-78pct']),
      rb('no-miljodirektoratet', ['emissions-permit', 'discharge-permit']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'us-tx',
    displayName: 'Oil & Gas (United States — Texas)',
    summary: 'Reserved profile — Texas onshore petroleum. Regulators: Texas Railroad Commission, TCEQ, IRS.',
    regulators: [
      rb('us-tx-rrc', ['p-1-production-report', 'p-4-operator-designation']),
      rb('us-tx-tceq', ['air-quality-permit', 'water-discharge-permit']),
      rb('us-irs', ['severance-tax-state-routed', 'corporate-income-federal']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'sa',
    displayName: 'Oil & Gas (Saudi Arabia)',
    summary: 'Reserved profile — Saudi Arabian upstream + downstream petroleum. Regulators: MEIM (Ministry of Energy, Industry + Mineral Resources), ZATCA.',
    regulators: [
      rb('sa-meim', ['production-monthly', 'concession-fee']),
      rb('sa-zatca', ['vat-monthly', 'corporate-zakat-income']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'ae',
    displayName: 'Oil & Gas (UAE)',
    summary: 'Reserved profile — UAE upstream petroleum (ADNOC supervisory). Regulators: Supreme Petroleum Council (SPC), FTA.',
    regulators: [
      rb('ae-spc', ['production-monthly', 'concession-renewal']),
      rb('ae-fta', ['vat-monthly', 'corporate-tax']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'iq',
    displayName: 'Oil & Gas (Iraq)',
    summary: 'Reserved profile — Iraqi upstream petroleum. Regulators: Ministry of Oil (MoO), General Commission of Taxes (GCT).',
    regulators: [
      rb('iq-moo', ['production-monthly', 'cost-recovery-claim']),
      rb('iq-gct', ['corporate-income', 'withholding-tax']),
    ],
  },
  {
    vertical: 'oilgas',
    region: 'kz',
    displayName: 'Oil & Gas (Kazakhstan)',
    summary: 'Reserved profile — Kazakh upstream petroleum. Regulators: Ministry of Energy (MoE), Kazakhstan State Revenue Committee (KGD).',
    regulators: [
      rb('kz-moe', ['production-monthly', 'subsoil-use-contract']),
      rb('kz-kgd', ['vat-quarterly', 'mineral-extraction-tax']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Fisheries (9 reserved)
// ---------------------------------------------------------------------------

const FISHERIES: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'fisheries',
    region: 'is',
    displayName: 'Fisheries (Iceland)',
    summary: 'Reserved profile — Icelandic ITQ fisheries. Regulators: Fiskistofa (Directorate of Fisheries), RSK (tax).',
    regulators: [
      rb('is-fiskistofa', ['catch-log-weekly', 'quota-trade']),
      rb('is-rsk', ['vat-bi-monthly', 'fishing-fee']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'no',
    displayName: 'Fisheries (Norway)',
    summary: 'Reserved profile — Norwegian fisheries. Regulators: Fiskeridirektoratet, Skatteetaten.',
    regulators: [
      rb('no-fiskeridirektoratet', ['catch-log-daily', 'quota-allocation']),
      rb('no-skatteetaten', ['vat-bi-monthly', 'resource-rent-tax']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'id',
    displayName: 'Fisheries (Indonesia)',
    summary: 'Reserved profile — Indonesian fisheries. Regulators: KKP (Ministry of Marine Affairs + Fisheries), DJP (tax).',
    regulators: [
      rb('id-kkp', ['catch-log-monthly', 'vessel-permit']),
      rb('id-djp', ['vat-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'vn',
    displayName: 'Fisheries (Vietnam)',
    summary: 'Reserved profile — Vietnamese fisheries. Regulators: D-FISH (Directorate of Fisheries), GDT (tax).',
    regulators: [
      rb('vn-dfish', ['catch-log', 'iuu-compliance']),
      rb('vn-gdt', ['vat-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'th',
    displayName: 'Fisheries (Thailand)',
    summary: 'Reserved profile — Thai fisheries. Regulators: DoF (Department of Fisheries), Revenue Department.',
    regulators: [
      rb('th-dof', ['catch-log-monthly', 'vessel-monitoring']),
      rb('th-rd', ['vat-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'cl',
    displayName: 'Fisheries (Chile)',
    summary: 'Reserved profile — Chilean fisheries. Regulators: SERNAPESCA, SII (tax).',
    regulators: [
      rb('cl-sernapesca', ['catch-declaration', 'aquaculture-permit']),
      rb('cl-sii', ['iva-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'pe',
    displayName: 'Fisheries (Peru)',
    summary: 'Reserved profile — Peruvian fisheries (anchoveta + others). Regulators: PRODUCE (Ministry of Production), SUNAT.',
    regulators: [
      rb('pe-produce', ['catch-declaration', 'fishing-quota']),
      rb('pe-sunat', ['igv-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'jp',
    displayName: 'Fisheries (Japan)',
    summary: 'Reserved profile — Japanese fisheries. Regulators: FAJ (Fisheries Agency), NTA (tax).',
    regulators: [
      rb('jp-faj', ['catch-quota-annual', 'vessel-registration']),
      rb('jp-nta', ['consumption-tax-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'fisheries',
    region: 'kr',
    displayName: 'Fisheries (South Korea)',
    summary: 'Reserved profile — Korean fisheries. Regulators: MOF (Ministry of Oceans + Fisheries), NTS (tax).',
    regulators: [
      rb('kr-mof', ['catch-log', 'quota-trade']),
      rb('kr-nts', ['vat-quarterly', 'corporate-income']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Forestry (8 reserved)
// ---------------------------------------------------------------------------

const FORESTRY: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'forestry',
    region: 'cd',
    displayName: 'Forestry (DR Congo)',
    summary: 'Reserved profile — Congolese forestry. Regulators: MEDD (Environment + Sustainable Development), DGI (tax).',
    regulators: [
      rb('cd-medd', ['felling-permit', 'eia']),
      rb('cd-dgi', ['vat-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'br',
    displayName: 'Forestry (Brazil)',
    summary: 'Reserved profile — Brazilian forestry. Regulators: IBAMA (environment + forestry enforcement), Receita Federal.',
    regulators: [
      rb('br-ibama', ['felling-licence', 'transport-permit-dof']),
      rb('br-rfb', ['icms-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'id',
    displayName: 'Forestry (Indonesia)',
    summary: 'Reserved profile — Indonesian forestry. Regulators: KLHK (Environment + Forestry), DJP.',
    regulators: [
      rb('id-klhk', ['ksh-felling-quota', 'svlk-legality']),
      rb('id-djp', ['vat-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'fi',
    displayName: 'Forestry (Finland)',
    summary: 'Reserved profile — Finnish forestry. Regulators: Metsähallitus (state forests), Vero (tax).',
    regulators: [
      rb('fi-metsahallitus', ['felling-notification', 'state-forest-permit']),
      rb('fi-vero', ['vat-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'ca',
    displayName: 'Forestry (Canada)',
    summary: 'Reserved profile — Canadian forestry. Regulators: provincial forest ministries (e.g. BC FOR), CRA.',
    regulators: [
      rb('ca-bcfor', ['cutting-permit', 'stumpage-return']),
      rb('ca-cra', ['gst-hst-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'ru',
    displayName: 'Forestry (Russia)',
    summary: 'Reserved profile — Russian forestry. Regulators: Rosleskhoz (Federal Forestry Agency), FNS (tax).',
    regulators: [
      rb('ru-rosleskhoz', ['felling-permit', 'forest-declaration']),
      rb('ru-fns', ['vat-quarterly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'my',
    displayName: 'Forestry (Malaysia)',
    summary: 'Reserved profile — Malaysian forestry. Regulators: state forest departments (e.g. SFD Sarawak), LHDN (tax).',
    regulators: [
      rb('my-sfd', ['felling-coupe', 'log-removal-pass']),
      rb('my-lhdn', ['sst-monthly', 'corporate-income']),
    ],
  },
  {
    vertical: 'forestry',
    region: 'gn',
    displayName: 'Forestry (Guinea)',
    summary: 'Reserved profile — Guinean forestry. Regulators: MEEF (Environment, Forests + Water), DGI.',
    regulators: [
      rb('gn-meef', ['felling-permit', 'transport-permit']),
      rb('gn-dgi', ['vat-monthly', 'corporate-income']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Manufacturing (8 reserved)
// ---------------------------------------------------------------------------

const MANUFACTURING: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'manufacturing',
    region: 'tz',
    displayName: 'Manufacturing (Tanzania)',
    summary: 'Reserved profile — Tanzanian manufacturing. Regulators: TRA, Tanzania Bureau of Standards (TBS), OSHA-TZ.',
    regulators: [
      rb('tz-tra', ['vat-monthly', 'corporate-income', 'paye-monthly']),
      rb('tz-tbs', ['product-conformity-licence']),
      rb('tz-osha', ['workplace-safety-audit']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'vn',
    displayName: 'Manufacturing (Vietnam)',
    summary: 'Reserved profile — Vietnamese manufacturing. Regulators: GDT (tax), MoIT (Industry + Trade).',
    regulators: [
      rb('vn-gdt', ['vat-monthly', 'corporate-income']),
      rb('vn-moit', ['industrial-licence-renewal', 'export-quota']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'bd',
    displayName: 'Manufacturing (Bangladesh)',
    summary: 'Reserved profile — Bangladeshi manufacturing (RMG + others). Regulators: NBR (tax), BIDA (investment authority).',
    regulators: [
      rb('bd-nbr', ['vat-monthly', 'corporate-income']),
      rb('bd-bida', ['investment-permit-renewal']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'mx',
    displayName: 'Manufacturing (Mexico)',
    summary: 'Reserved profile — Mexican manufacturing (IMMEX maquiladora etc.). Regulators: SAT (tax), SE (economy ministry).',
    regulators: [
      rb('mx-sat', ['iva-monthly', 'corporate-income']),
      rb('mx-se', ['immex-renewal', 'export-declaration']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'cz',
    displayName: 'Manufacturing (Czechia)',
    summary: 'Reserved profile — Czech manufacturing. Regulators: General Financial Directorate (GFR), MPO (Industry + Trade).',
    regulators: [
      rb('cz-gfr', ['vat-monthly', 'corporate-income']),
      rb('cz-mpo', ['industrial-permit']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'pl',
    displayName: 'Manufacturing (Poland)',
    summary: 'Reserved profile — Polish manufacturing. Regulators: KAS (national revenue administration), MAP (asset ministry).',
    regulators: [
      rb('pl-kas', ['vat-jpk-monthly', 'corporate-income']),
      rb('pl-map', ['industrial-licence']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'in',
    displayName: 'Manufacturing (India)',
    summary: 'Reserved profile — Indian manufacturing. Regulators: GSTN, DPIIT (industrial policy).',
    regulators: [
      rb('in-gstn', ['gst-monthly', 'corporate-income']),
      rb('in-dpiit', ['industrial-licence-renewal']),
    ],
  },
  {
    vertical: 'manufacturing',
    region: 'cn',
    displayName: 'Manufacturing (China)',
    summary: 'Reserved profile — Chinese manufacturing. Regulators: STA (State Taxation Administration), MIIT (Industry + IT).',
    regulators: [
      rb('cn-sta', ['vat-monthly', 'corporate-income']),
      rb('cn-miit', ['ccc-certification', 'export-permit']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Tourism (12 reserved)
// ---------------------------------------------------------------------------

const TOURISM: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'tourism',
    region: 'tz',
    displayName: 'Tourism (Tanzania)',
    summary: 'Reserved profile — Tanzanian tourism + national-park concessions. Regulators: TRA, TANAPA, MNRT, NCAA.',
    regulators: [
      rb('tz-tra', ['vat-monthly', 'tourism-development-levy']),
      rb('tz-tanapa', ['concession-fee-quarterly']),
      rb('tz-mnrt', ['operator-licence-renewal']),
      rb('tz-ncaa', ['ngorongoro-permit']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'ke',
    displayName: 'Tourism (Kenya)',
    summary: 'Reserved profile — Kenyan tourism + KWS concessions. Regulators: KRA, Kenya Wildlife Service (KWS), Tourism Regulatory Authority (TRA-KE).',
    regulators: [
      rb('ke-kra', ['vat-monthly', 'tourism-levy']),
      rb('ke-kws', ['park-concession-fee']),
      rb('ke-tra', ['operator-licence-renewal']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'za',
    displayName: 'Tourism (South Africa)',
    summary: 'Reserved profile — South African tourism + SANParks concessions. Regulators: SARS, SANParks.',
    regulators: [
      rb('za-sars', ['vat-monthly', 'tourism-levy']),
      rb('za-sanparks', ['concession-fee-quarterly']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'id',
    displayName: 'Tourism (Indonesia)',
    summary: 'Reserved profile — Indonesian tourism (Bali, Komodo, …). Regulators: DJP (tax), Kemenparekraf (Tourism Ministry).',
    regulators: [
      rb('id-djp', ['vat-monthly', 'tourism-tax']),
      rb('id-kemenparekraf', ['operator-licence-renewal']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'th',
    displayName: 'Tourism (Thailand)',
    summary: 'Reserved profile — Thai tourism. Regulators: Revenue Department, Tourism Authority of Thailand (TAT).',
    regulators: [
      rb('th-rd', ['vat-monthly', 'tourism-tax']),
      rb('th-tat', ['operator-licence']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'vn',
    displayName: 'Tourism (Vietnam)',
    summary: 'Reserved profile — Vietnamese tourism. Regulators: GDT (tax), VNAT (Vietnam National Tourism Authority).',
    regulators: [
      rb('vn-gdt', ['vat-monthly', 'tourism-levy']),
      rb('vn-vnat', ['operator-permit']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'gr',
    displayName: 'Tourism (Greece)',
    summary: 'Reserved profile — Greek tourism. Regulators: AADE (Independent Authority of Public Revenue), Ministry of Tourism.',
    regulators: [
      rb('gr-aade', ['vat-monthly', 'overnight-stay-tax']),
      rb('gr-mot', ['eot-operator-licence']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'it',
    displayName: 'Tourism (Italy)',
    summary: 'Reserved profile — Italian tourism. Regulators: Agenzia delle Entrate, MIBACT (Culture + Tourism).',
    regulators: [
      rb('it-ade', ['iva-monthly', 'imposta-soggiorno-municipal']),
      rb('it-mibact', ['operator-licence']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'es',
    displayName: 'Tourism (Spain)',
    summary: 'Reserved profile — Spanish tourism. Regulators: AEAT (tax agency), MITUR (Ministry of Industry, Trade + Tourism).',
    regulators: [
      rb('es-aeat', ['iva-monthly', 'corporate-income']),
      rb('es-mitur', ['operator-renewal']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'fr',
    displayName: 'Tourism (France)',
    summary: 'Reserved profile — French tourism. Regulators: DGFiP (public finances), ATOUT-FR.',
    regulators: [
      rb('fr-dgfip', ['tva-monthly', 'taxe-de-sejour-municipal']),
      rb('fr-atout', ['operator-renewal']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'ae',
    displayName: 'Tourism (UAE)',
    summary: 'Reserved profile — UAE tourism (Dubai + Abu Dhabi). Regulators: FTA, DTCM (Dubai Tourism + Commerce Marketing).',
    regulators: [
      rb('ae-fta', ['vat-monthly', 'tourism-fee']),
      rb('ae-dtcm', ['operator-renewal']),
    ],
  },
  {
    vertical: 'tourism',
    region: 'sg',
    displayName: 'Tourism (Singapore)',
    summary: 'Reserved profile — Singaporean tourism. Regulators: IRAS (tax), STB (Singapore Tourism Board).',
    regulators: [
      rb('sg-iras', ['gst-quarterly', 'corporate-income']),
      rb('sg-stb', ['operator-licence']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Real estate (10 reserved)
// ---------------------------------------------------------------------------

const REALESTATE: ReadonlyArray<ReservedSpec> = Object.freeze([
  {
    vertical: 'realestate',
    region: 'tz',
    displayName: 'Real Estate (Tanzania)',
    summary: 'Reserved profile — Tanzanian real estate. Regulators: TRA, Ministry of Lands (MoL-TZ).',
    regulators: [
      rb('tz-tra', ['vat-monthly', 'property-tax']),
      rb('tz-mol', ['title-transfer-stamp-duty']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'ke',
    displayName: 'Real Estate (Kenya)',
    summary: 'Reserved profile — Kenyan real estate. Regulators: KRA, National Land Commission (NLC).',
    regulators: [
      rb('ke-kra', ['vat-monthly', 'rental-income-tax']),
      rb('ke-nlc', ['title-transfer-stamp-duty']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'ng',
    displayName: 'Real Estate (Nigeria)',
    summary: 'Reserved profile — Nigerian real estate. Regulators: FIRS, Federal Capital Development Authority (FCDA).',
    regulators: [
      rb('ng-firs', ['vat-monthly', 'capital-gains-tax']),
      rb('ng-fcda', ['certificate-of-occupancy-renewal']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'ae',
    displayName: 'Real Estate (UAE — Dubai)',
    summary: 'Reserved profile — UAE / Dubai real estate. Regulators: FTA (federal VAT), RERA-Dubai (Real Estate Regulatory Agency).',
    regulators: [
      rb('ae-fta', ['vat-monthly', 'corporate-tax']),
      rb('ae-rera-dubai', ['service-charge-audit', 'broker-licence-renewal']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'sg',
    displayName: 'Real Estate (Singapore)',
    summary: 'Reserved profile — Singapore real estate. Regulators: IRAS, URA (Urban Redevelopment Authority).',
    regulators: [
      rb('sg-iras', ['gst-quarterly', 'property-tax', 'stamp-duty']),
      rb('sg-ura', ['planning-permission']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'gb',
    displayName: 'Real Estate (United Kingdom)',
    summary: 'Reserved profile — UK real estate. Regulators: HMRC, HM Land Registry (HMLR).',
    regulators: [
      rb('gb-hmrc', ['vat-quarterly', 'stamp-duty-land-tax', 'capital-gains-tax']),
      rb('gb-hmlr', ['title-registration']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'us-ca',
    displayName: 'Real Estate (United States — California)',
    summary: 'Reserved profile — California real estate. Regulators: California Franchise Tax Board (FTB), Department of Real Estate (DRE).',
    regulators: [
      rb('us-ca-ftb', ['state-income-tax', 'sales-tax-state-routed']),
      rb('us-ca-dre', ['broker-licence-renewal']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'us-ny',
    displayName: 'Real Estate (United States — New York)',
    summary: 'Reserved profile — New York real estate. Regulators: NYSDTF (Dept Taxation + Finance), NYSHCR (Homes + Community Renewal).',
    regulators: [
      rb('us-ny-dtf', ['state-income-tax', 'rpt-real-property-transfer-tax']),
      rb('us-ny-hcr', ['rent-stabilisation-filing']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'de',
    displayName: 'Real Estate (Germany)',
    summary: 'Reserved profile — German real estate. Regulators: Finanzamt (federal-state tax office network), Grundbuchamt (land registry).',
    regulators: [
      rb('de-finanzamt', ['ust-monthly', 'grunderwerbsteuer-stamp']),
      rb('de-grundbuchamt', ['title-registration']),
    ],
  },
  {
    vertical: 'realestate',
    region: 'fr',
    displayName: 'Real Estate (France)',
    summary: 'Reserved profile — French real estate. Regulators: DGFiP, Bureau National du Foncier (cadastre).',
    regulators: [
      rb('fr-dgfip', ['tva-monthly', 'taxe-fonciere']),
      rb('fr-cadastre', ['title-registration']),
    ],
  },
]);

// ---------------------------------------------------------------------------
// Assembled list (74 reserved)
// ---------------------------------------------------------------------------

const ALL_SPECS: ReadonlyArray<ReservedSpec> = Object.freeze([
  ...MINING,
  ...AGRI,
  ...OILGAS,
  ...FISHERIES,
  ...FORESTRY,
  ...MANUFACTURING,
  ...TOURISM,
  ...REALESTATE,
]);

export const RESERVED_PROFILES: ReadonlyArray<VerticalProfileDefinition> =
  Object.freeze(ALL_SPECS.map(mkReserved));
