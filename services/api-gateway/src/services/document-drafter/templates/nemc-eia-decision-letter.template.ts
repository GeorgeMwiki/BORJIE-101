/**
 * NEMC EIA Decision Letter — Wave NEMC-EIA-LETTER.
 *
 * Drafts the regulator-format decision letter the National Environment
 * Management Council (NEMC) issues following an Environmental Impact
 * Assessment review. Mirrors the actual NEMC letter format: header
 * logo placeholder, reference number, addressee, decision body,
 * recommended conditions list, signature block.
 *
 * Owners use this template to PRE-DRAFT the letter they expect from
 * NEMC so the regulator's eventual letter can be compared against
 * their own ESIA scope.
 */

import { z } from 'zod';
import type { UniversalTemplate } from './types.js';

const vars = z.object({
  siteId: z.string().min(1).max(128),
  siteName: z.string().min(1).max(240),
  licenceId: z.string().min(1).max(128),
  licenceNumber: z.string().min(1).max(80),
  eiaReferenceNo: z.string().min(1).max(80),
  scopingComplete: z.boolean(),
  esiaComplete: z.boolean(),
  /** Optional ISO date YYYY-MM-DD for the scheduled public hearing. */
  publicHearingDate: z.string().min(10).max(10).optional(),
  recommendedConditions: z
    .array(z.string().trim().min(8).max(800))
    .min(1)
    .max(40),
  /** Reviewing officer. */
  signingOfficerName: z.string().min(1).max(160),
  signingOfficerTitle: z.string().min(1).max(160).default('Director General'),
  decisionDate: z.string().min(10).max(10).optional(),
  /** Outcome: approved / approved_with_conditions / deferred / rejected. */
  decision: z
    .enum([
      'approved',
      'approved_with_conditions',
      'deferred',
      'rejected',
    ])
    .default('approved_with_conditions'),
  /** Addressee (owner trading name + postal). */
  addresseeName: z.string().min(1).max(240),
  addresseeAddress: z.string().min(1).max(400),
});

type Vars = z.infer<typeof vars>;

function decisionPhrase(v: Vars, lang: 'sw' | 'en'): string {
  if (lang === 'sw') {
    switch (v.decision) {
      case 'approved':
        return `Baada ya kupitia tathmini yako ya EIA, NEMC INAIDHINISHA mradi huu bila masharti ya ziada.`;
      case 'approved_with_conditions':
        return `Baada ya kupitia tathmini yako ya EIA, NEMC INAIDHINISHA mradi huu KWA MASHARTI yaliyoorodheshwa hapa chini.`;
      case 'deferred':
        return `Baada ya kupitia tathmini yako ya EIA, NEMC IMEAHIRISHA uamuzi hadi taarifa zaidi zitakapowasilishwa.`;
      case 'rejected':
        return `Baada ya kupitia tathmini yako ya EIA, NEMC IMEKATAA maombi haya kwa sababu zilizoorodheshwa.`;
    }
  }
  switch (v.decision) {
    case 'approved':
      return `Following review of the Environmental Impact Assessment you submitted, NEMC has APPROVED the proposed undertaking without further conditions.`;
    case 'approved_with_conditions':
      return `Following review of the Environmental Impact Assessment you submitted, NEMC has APPROVED the proposed undertaking SUBJECT TO the conditions listed below.`;
    case 'deferred':
      return `Following review of the Environmental Impact Assessment you submitted, NEMC has DEFERRED its decision pending further information specified below.`;
    case 'rejected':
      return `Following review of the Environmental Impact Assessment you submitted, NEMC has REJECTED the application for the reasons listed below.`;
  }
}

export const nemcEiaDecisionLetterTemplate: UniversalTemplate = {
  id: 'nemc-eia-decision-letter',
  title: {
    en: 'NEMC EIA Decision Letter',
    sw: 'Barua ya Maamuzi ya EIA — NEMC',
  },
  kind: 'letter',
  description:
    'Decision letter mirroring the NEMC EIA outcome format — header / reference / addressee / decision body / numbered conditions / signature block.',
  variables: vars,
  composeMarkdown(raw, context) {
    const v = vars.parse(raw);
    const lang = context.language ?? 'en';
    const date = v.decisionDate ?? new Date().toISOString().slice(0, 10);
    const decisionText = decisionPhrase(v, lang);

    const conditionsBlock = v.recommendedConditions
      .map((c, i) => `${i + 1}. ${c.trim()}`)
      .join('\n');

    const swSummary = [
      `**Muhtasari (sw):**`,
      `- Mradi: ${v.siteName} (site ${v.siteId}, leseni ${v.licenceNumber})`,
      `- Kumb ya EIA: ${v.eiaReferenceNo}`,
      `- Uamuzi: ${v.decision}`,
      `- Masharti yaliyopendekezwa: ${v.recommendedConditions.length}`,
      v.publicHearingDate
        ? `- Tarehe ya kikao cha umma: ${v.publicHearingDate}`
        : `- Hakuna kikao cha umma kilichoratibiwa`,
    ].join('\n');

    return [
      `[NEMC LOGO]`,
      ``,
      `# THE UNITED REPUBLIC OF TANZANIA`,
      `## NATIONAL ENVIRONMENT MANAGEMENT COUNCIL (NEMC)`,
      `### Environmental Impact Assessment Decision`,
      ``,
      `**Our Ref:** ${v.eiaReferenceNo}`,
      `**Your Ref:** Site ${v.siteId} — Licence ${v.licenceNumber}`,
      `**Date:** ${date}`,
      ``,
      `To:`,
      `${v.addresseeName}`,
      `${v.addresseeAddress}`,
      ``,
      `Dear Sir / Madam,`,
      ``,
      `**RE: ENVIRONMENTAL IMPACT ASSESSMENT — ${v.siteName.toUpperCase()}**`,
      ``,
      decisionText,
      ``,
      `## 1. Scoping and ESIA Status`,
      ``,
      `1.1 Scoping submission: ${v.scopingComplete ? 'COMPLETE' : 'INCOMPLETE'}.`,
      `1.2 Full ESIA submission: ${v.esiaComplete ? 'COMPLETE' : 'INCOMPLETE'}.`,
      v.publicHearingDate
        ? `1.3 Public hearing scheduled for ${v.publicHearingDate} at the District Commissioner's office in the project locality.`
        : `1.3 No public hearing has been scheduled; NEMC reserves the right to convene one at any time before final certification.`,
      ``,
      `## 2. Recommended Conditions`,
      ``,
      conditionsBlock,
      ``,
      `## 3. Reporting and Compliance`,
      ``,
      `3.1 The proponent shall submit quarterly environmental monitoring reports to NEMC's Compliance Directorate within 30 days of the close of each quarter.`,
      ``,
      `3.2 Any material change to the project scope shall require a fresh scoping submission and may trigger a supplementary ESIA.`,
      ``,
      `## 4. Right of Appeal`,
      ``,
      `4.1 The proponent may appeal this decision in writing to the Minister responsible for the environment within thirty (30) days of receipt, citing the specific grounds.`,
      ``,
      `Yours faithfully,`,
      ``,
      `_______________________________`,
      `${v.signingOfficerName}`,
      `${v.signingOfficerTitle}`,
      `For: NATIONAL ENVIRONMENT MANAGEMENT COUNCIL (NEMC)`,
      ``,
      `---`,
      ``,
      swSummary,
      ``,
      lang === 'sw'
        ? `_Hati hii imeundwa na Bwana Mwikila kwa kushirikiana na Borjie kama rasimu ya kikanuni. Hii SI hati rasmi ya NEMC._`
        : `_Drafted by Mr. Mwikila with Borjie as a regulator-format draft. This is NOT an official NEMC document._`,
    ].join('\n');
  },
  renderHints: { classification: 'confidential', headerLogo: true, coverPage: false },
};
