/**
 * Off-Taker Master Sale Agreement (MSA) — Wave OFF-TAKER-MSA.
 *
 * Mining-domain master sale agreement bound to an off-taker contract.
 * The owner's home chat asks Mr. Mwikila to draft an off-taker MSA;
 * the brain forwards the structured form to this template which
 * composes a bilingual (sw/en summary block + full English body)
 * markdown draft suitable for legal review and PDF rendering.
 *
 * Pricing formula defaults to the LBMA AM gold fix minus a TZS-quoted
 * treatment + refining charge — owner can override per draft.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const COMMODITIES = [
  'gold',
  'copper',
  'tin',
  'tantalum',
  'tungsten',
  'coltan',
  'silver',
  'lithium',
  'graphite',
  'cobalt',
  'other',
] as const;

const PRICE_FORMULAS = [
  'lbma_pm_fix_minus_charges',
  'lbma_am_fix_minus_charges',
  'lme_3m_minus_charges',
  'fixed_price',
  'negotiated_per_lot',
] as const;

const vars = z.object({
  counterpartyId: z.string().min(1).max(128),
  counterpartyName: z.string().min(1).max(240),
  counterpartyJurisdiction: z.string().min(2).max(120),
  commodity: z.enum(COMMODITIES),
  gradeMin: z
    .string()
    .min(1)
    .max(60)
    .describe('Minimum acceptable grade, e.g. "Au ≥ 92% fineness" or "Cu ≥ 25%".'),
  volumeKg: z.number().positive(),
  /** ISO start date YYYY-MM-DD. */
  deliveryWindowStart: z.string().min(10).max(10),
  /** ISO end date YYYY-MM-DD. */
  deliveryWindowEnd: z.string().min(10).max(10),
  priceFormula: z.enum(PRICE_FORMULAS).default('lbma_pm_fix_minus_charges'),
  /** Optional explicit treatment + refining charge (TC/RC) in USD/oz. */
  treatmentRefiningChargeUsdPerOz: z.number().nonnegative().optional(),
  /** Optional fixed-price overrides for fixed_price / negotiated rows. */
  fixedPriceTzsPerKg: z.number().positive().optional(),
  paymentTermsDays: z.number().int().min(0).max(180).default(30),
  /** Forum / venue for dispute resolution. */
  disputeForum: z
    .enum(['tanzania-arbitration-centre', 'lcia-london', 'icc-paris', 'iccaa'])
    .default('tanzania-arbitration-centre'),
  /** Governing law jurisdiction. */
  governingLaw: z.string().min(2).max(120).default('Tanzania'),
  /** Seller signatory. */
  sellerSignatoryName: z.string().min(1).max(160),
  sellerSignatoryTitle: z.string().min(1).max(160),
  /** Buyer signatory. */
  buyerSignatoryName: z.string().min(1).max(160),
  buyerSignatoryTitle: z.string().min(1).max(160),
  /** Effective date — defaults to today. */
  effectiveDate: z.string().min(10).max(10).optional(),
});

type Vars = z.infer<typeof vars>;

function formatPriceFormula(v: Vars): string {
  const charges =
    v.treatmentRefiningChargeUsdPerOz != null
      ? ` − USD ${v.treatmentRefiningChargeUsdPerOz.toFixed(2)}/oz TC/RC`
      : ' − TC/RC per Schedule A';
  switch (v.priceFormula) {
    case 'lbma_am_fix_minus_charges':
      return `LBMA AM fix (USD/oz)${charges}, converted to TZS at BoT mid-rate on settlement date`;
    case 'lbma_pm_fix_minus_charges':
      return `LBMA PM fix (USD/oz)${charges}, converted to TZS at BoT mid-rate on settlement date`;
    case 'lme_3m_minus_charges':
      return `LME 3-month official price (USD/t)${charges}, converted to TZS at BoT mid-rate on settlement date`;
    case 'fixed_price':
      return v.fixedPriceTzsPerKg != null
        ? `Fixed price TZS ${v.fixedPriceTzsPerKg.toLocaleString()}/kg`
        : 'Fixed price per Schedule A';
    case 'negotiated_per_lot':
      return 'Negotiated per consignment, ratified by exchange of email + counterparty PO';
    default:
      return 'Per Schedule A';
  }
}

function summaryBlock(v: Vars, lang: 'sw' | 'en'): string {
  if (lang === 'sw') {
    return [
      `**Muhtasari wa Mkataba (sw):**`,
      `- Muuzaji: kampuni ya mmiliki`,
      `- Mnunuzi: ${v.counterpartyName} (${v.counterpartyJurisdiction})`,
      `- Bidhaa: ${v.commodity.toUpperCase()}, kiwango cha chini ${v.gradeMin}`,
      `- Kiasi: ${v.volumeKg.toLocaleString()} kg`,
      `- Madirisha ya utoaji: ${v.deliveryWindowStart} hadi ${v.deliveryWindowEnd}`,
      `- Mfumo wa bei: ${formatPriceFormula(v)}`,
      `- Masharti ya malipo: siku ${v.paymentTermsDays} baada ya hati ya kupokea`,
      `- Sheria inayohusika: ${v.governingLaw}`,
      `- Mahali pa ufumbuzi wa mzozo: ${v.disputeForum}`,
    ].join('\n');
  }
  return [
    `**Plain-English summary (en):**`,
    `- Seller: the owner company`,
    `- Buyer: ${v.counterpartyName} (${v.counterpartyJurisdiction})`,
    `- Commodity: ${v.commodity.toUpperCase()}, minimum grade ${v.gradeMin}`,
    `- Volume: ${v.volumeKg.toLocaleString()} kg`,
    `- Delivery window: ${v.deliveryWindowStart} to ${v.deliveryWindowEnd}`,
    `- Pricing: ${formatPriceFormula(v)}`,
    `- Payment terms: ${v.paymentTermsDays} days from delivery receipt`,
    `- Governing law: ${v.governingLaw}`,
    `- Dispute resolution: ${v.disputeForum}`,
  ].join('\n');
}

export const offTakerMasterSaleAgreementTemplate: UniversalTemplate = {
  id: 'off-taker-master-sale-agreement',
  title: {
    en: 'Off-Taker Master Sale Agreement',
    sw: 'Mkataba Mkuu wa Uuzaji wa Mnunuzi',
  },
  kind: 'contract',
  description:
    'Mining off-taker master sale agreement (commodity, grade, volume, LBMA price formula, delivery terms, dispute forum). Bilingual sw/en summary block + full English body.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const effective = v.effectiveDate ?? new Date().toISOString().slice(0, 10);
    const tradingName =
      context.tenantTradingName ??
      context.ownerProfile?.tenantTradingName ??
      '[Owner trading name]';

    const swSummary = summaryBlock(v, 'sw');
    const enSummary = summaryBlock(v, 'en');

    return [
      `# OFF-TAKER MASTER SALE AGREEMENT`,
      ``,
      `**Effective Date:** ${effective}`,
      ``,
      swSummary,
      ``,
      enSummary,
      ``,
      `---`,
      ``,
      `## 1. Parties`,
      ``,
      `1.1 SELLER: ${tradingName}, a company incorporated under the laws of the United Republic of Tanzania.`,
      ``,
      `1.2 BUYER: ${v.counterpartyName}, a company incorporated under the laws of ${v.counterpartyJurisdiction} (counterparty reference ${v.counterpartyId}).`,
      ``,
      `## 2. Commodity, Grade and Volume`,
      ``,
      `2.1 The SELLER agrees to deliver and the BUYER agrees to purchase the commodity ${v.commodity.toUpperCase()} meeting a minimum grade of ${v.gradeMin}.`,
      ``,
      `2.2 The aggregate volume to be delivered under this Agreement is ${v.volumeKg.toLocaleString()} kilograms (the "Contract Quantity").`,
      ``,
      `## 3. Delivery Window`,
      ``,
      `3.1 First delivery shall occur on or after ${v.deliveryWindowStart}; final delivery shall occur on or before ${v.deliveryWindowEnd}.`,
      ``,
      `3.2 Each lot shall be accompanied by a TBS assay certificate (Au) or equivalent regulator-recognised certificate (other commodities) issued no earlier than 30 days before dispatch.`,
      ``,
      `## 4. Price Formula`,
      ``,
      `4.1 The price payable per kilogram for each lot shall be: ${formatPriceFormula(v)}.`,
      ``,
      `4.2 The settlement currency is TZS unless the BUYER's domicile is non-Tanzanian and the BoT post-cliff USD remediation regime expressly permits USD settlement.`,
      ``,
      `## 5. Payment Terms`,
      ``,
      `5.1 The BUYER shall pay the SELLER within ${v.paymentTermsDays} calendar days of the dated delivery receipt countersigned by the BUYER's authorised representative.`,
      ``,
      `5.2 Late payments accrue interest at the BoT discount rate + 4% per annum, calculated daily.`,
      ``,
      `## 6. Delivery Terms`,
      ``,
      `6.1 Delivery shall be DAP (Incoterms 2020) to the BUYER's nominated warehouse, with the SELLER bearing transport, insurance, and origin-certification costs to that point.`,
      ``,
      `6.2 Title and risk transfer on the BUYER's signed receipt of conforming material.`,
      ``,
      `## 7. Compliance Warranties`,
      ``,
      `7.1 The SELLER warrants that all material delivered hereunder originates from licensed mining operations within Tanzania and that all applicable royalties under the Mining Act have been paid prior to dispatch.`,
      ``,
      `7.2 The SELLER warrants compliance with the Mining (Local Content) Regulations and that all subcontractors hold valid TUMEMADINI authorisations.`,
      ``,
      `## 8. Dispute Resolution`,
      ``,
      `8.1 This Agreement is governed by the laws of ${v.governingLaw}.`,
      ``,
      `8.2 Any dispute arising shall be submitted to ${v.disputeForum} for binding arbitration in accordance with its rules in force on the date of the dispute notice.`,
      ``,
      `## 9. Signatures`,
      ``,
      `Signed for and on behalf of the SELLER:`,
      ``,
      `_______________________________`,
      `${v.sellerSignatoryName}`,
      `${v.sellerSignatoryTitle}`,
      `Date: __________________________`,
      ``,
      `Signed for and on behalf of the BUYER:`,
      ``,
      `_______________________________`,
      `${v.buyerSignatoryName}`,
      `${v.buyerSignatoryTitle}`,
      `Date: __________________________`,
      ``,
      lang === 'sw'
        ? `_Hati hii imeundwa na Bwana Mwikila kwa kushirikiana na Borjie. Tafadhali pitisha kwa wakili wako kabla ya kusaini._`
        : `_Drafted by Mr. Mwikila with Borjie. Please obtain counsel sign-off before execution._`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true, coverPage: true },
};
