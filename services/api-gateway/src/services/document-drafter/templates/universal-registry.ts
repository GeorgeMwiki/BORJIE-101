/**
 * Registry of the 18 TS-module mining-estate templates.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. The v1 paired `.sw.md`/`.en.md` templates
 * continue to live in `./index.ts`. The 18 richer templates live here
 * and expose a `composeMarkdown(vars, context)` API that returns the
 * final document body in one call (no separate placeholder pass).
 *
 * Note: the two sibling-owned templates
 * (`off-taker-master-sale-agreement` and `nemc-eia-decision-letter`)
 * are explicitly NOT included here; they ship from sibling #125.
 */

import type { UniversalTemplate } from './types.js';
import { memoInternalTemplate } from './memo-internal.template.js';
import { letterRegulatorTemplate } from './letter-regulator.template.js';
import { letterSupplierTemplate } from './letter-supplier.template.js';
import { letterBuyerTemplate } from './letter-buyer.template.js';
import { mouCooperativeTemplate } from './mou-cooperative.template.js';
import { boardResolutionTemplate } from './board-resolution.template.js';
import { partnershipDeedTemplate } from './partnership-deed.template.js';
import { businessPlanTemplate } from './business-plan.template.js';
import { financialStatementSummaryTemplate } from './financial-statement-summary.template.js';
import { auditReportInternalTemplate } from './audit-report-internal.template.js';
import { cdaCommunityTemplate } from './cda-community.template.js';
import { sponsorshipProposalTemplate } from './sponsorship-proposal.template.js';
import { rfpEquipmentTemplate } from './rfp-equipment.template.js';
import { tenderResponseTemplate } from './tender-response.template.js';
import { performanceReviewTemplate } from './performance-review.template.js';
import { employmentOfferLetterTemplate } from './employment-offer-letter.template.js';
import { dismissalLetterTemplate } from './dismissal-letter.template.js';
import { sopBlastSafetyTemplate } from './sop-blast-safety.template.js';
import { trainingMaterialTemplate } from './training-material.template.js';
import { manualOperationsTemplate } from './manual-operations.template.js';

export const UNIVERSAL_TEMPLATES: ReadonlyArray<UniversalTemplate> = [
  memoInternalTemplate,
  letterRegulatorTemplate,
  letterSupplierTemplate,
  letterBuyerTemplate,
  mouCooperativeTemplate,
  boardResolutionTemplate,
  partnershipDeedTemplate,
  businessPlanTemplate,
  financialStatementSummaryTemplate,
  auditReportInternalTemplate,
  cdaCommunityTemplate,
  sponsorshipProposalTemplate,
  rfpEquipmentTemplate,
  tenderResponseTemplate,
  performanceReviewTemplate,
  employmentOfferLetterTemplate,
  dismissalLetterTemplate,
  sopBlastSafetyTemplate,
  trainingMaterialTemplate,
  manualOperationsTemplate,
];

const INDEX_BY_ID = new Map<string, UniversalTemplate>(
  UNIVERSAL_TEMPLATES.map((t) => [t.id, t]),
);

export function findUniversalTemplate(id: string): UniversalTemplate | undefined {
  return INDEX_BY_ID.get(id);
}

export function listUniversalTemplates(): ReadonlyArray<{
  readonly id: string;
  readonly title: { en: string; sw: string };
  readonly kind: string;
  readonly description: string;
}> {
  return UNIVERSAL_TEMPLATES.map((t) => ({
    id: t.id,
    title: t.title,
    kind: t.kind,
    description: t.description,
  }));
}
