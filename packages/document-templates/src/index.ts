/**
 * `@borjie/document-templates` — public surface.
 *
 * Layer 1-2-3 of the Document Composition architecture per
 * `docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`. Provides:
 *
 *   - The closed-set 11 document recipes (registry).
 *   - Layer 2 dispatcher (`composeDoc`).
 *   - Brand-locked Layer 3 renderers (PDF/DOCX/XLSX/PPTX/MD/HTML).
 *   - Citation embedding + audit-chain link.
 *   - Tier-2 approval workflow.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ApprovalState,
  AuthorityTier,
  CitationContract,
  DataJoin,
  DocComposeContext,
  DocumentArtifact,
  DocumentClass,
  DocumentFormat,
  DocumentRecipe,
  IRBlock,
  IRBlockKind,
  IRDoc,
  IRSection,
  InputContract,
  MasteryTier,
  OwnerProfile,
  RecipeStatus,
  SpanCitation,
  TargetAudience,
} from './types.js';

export { CompositionError } from './types.js';

// ---------------------------------------------------------------------------
// Registry + composer
// ---------------------------------------------------------------------------

export {
  BUILT_IN_RECIPES,
  DocumentRecipeRegistry,
  defaultRecipeRegistry,
} from './registry.js';

export { composeDoc } from './composer.js';
export type { ComposeDocArgs } from './composer.js';

// ---------------------------------------------------------------------------
// Brand-lock — palette + validators + renderers
// ---------------------------------------------------------------------------

export {
  BRAND_COLOR_PALETTE,
  BRAND_CSS_VAR_PREFIXES,
  BRAND_FONT_FAMILIES,
  isBrandColor,
  isBrandCssVar,
  isBrandFont,
  isOklchInGamut,
  lintBrand,
} from './brand-lock/index.js';
export type { BrandLintArgs, BrandLintResult } from './brand-lock/index.js';

export {
  validateHtmlBrand,
  validateNativeBrandColors,
  validateNativeBrandFonts,
} from './brand-lock/brand-validator.js';

export { brandPdf, renderIRDocToHtml } from './brand-lock/pdf-brander.js';
export type { BrandPdfResult } from './brand-lock/pdf-brander.js';
export { brandDocx } from './brand-lock/docx-brander.js';
export type { BrandDocxResult } from './brand-lock/docx-brander.js';
export { brandXlsx } from './brand-lock/xlsx-brander.js';
export type { BrandXlsxResult } from './brand-lock/xlsx-brander.js';
export { brandPptx } from './brand-lock/pptx-brander.js';
export type { BrandPptxResult } from './brand-lock/pptx-brander.js';

// ---------------------------------------------------------------------------
// Citation embedding + audit-chain link
// ---------------------------------------------------------------------------

export {
  enforceCitationGate,
  extractCorpus,
  formatFootnote,
} from './citations/embedder.js';
export {
  buildDocAuditLink,
  type DocAuditLink,
  type DocAuditLinkArgs,
} from './citations/audit-chain-link.js';

// ---------------------------------------------------------------------------
// Approval workflow
// ---------------------------------------------------------------------------

export {
  approveArtifact,
  initialApprovalState,
  markAutoPublished,
  rejectArtifact,
  type ApproveArgs,
  type RejectArgs,
} from './approval/workflow.js';

// ---------------------------------------------------------------------------
// Individual recipe exports — useful for tests, lock/improve worker
// ---------------------------------------------------------------------------

export { dailyBriefingRecipe } from './recipes/daily-briefing.js';
export { boardReportRecipe } from './recipes/board-report.js';
export { investorBriefingRecipe } from './recipes/investor-briefing.js';
export { tumemadiniReturnRecipe } from './recipes/tumemadini-return.js';
export { nemcFilingRecipe } from './recipes/nemc-filing.js';
export { buyerKybPackRecipe } from './recipes/buyer-kyb-pack.js';
export { sopRecipe } from './recipes/sop.js';
export { financialModelRecipe } from './recipes/financial-model.js';
export { contractRecipe } from './recipes/contract.js';
export { geologicalReportRecipe } from './recipes/geological-report.js';
export { marketplaceListingRecipe } from './recipes/marketplace-listing.js';
