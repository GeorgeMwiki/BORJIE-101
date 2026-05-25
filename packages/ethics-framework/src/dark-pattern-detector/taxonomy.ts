/**
 * Brignull / Mathur dark-pattern taxonomy (14 categories).
 *
 * Sources:
 *  - Harry Brignull, "Deceptive Design" / "Dark Patterns" original
 *    taxonomy (2010+). https://www.deceptive.design/types
 *  - Arunesh Mathur et al., "Dark Patterns at Scale: Findings from a
 *    Crawl of 11K Shopping Websites", CSCW 2019. arXiv:1907.07032
 *  - EU Council Directive 2005/29/EC (Unfair Commercial Practices),
 *    Annex I — list of practices "in all circumstances unfair".
 *  - FTC Section 5(a) "unfair or deceptive acts or practices"
 *    enforcement actions (eg. ED Tech complaints 2022).
 *  - EU Data Act, Recital 15 / Digital Services Act Art. 25 (DSA)
 *    explicit dark-pattern ban for VLOPs (2024).
 */

import type { BrignullDarkPattern, EthicsSeverity } from '../types.js';

export interface BrignullCategorySpec {
  readonly type: BrignullDarkPattern;
  readonly displayName: string;
  readonly description: string;
  readonly severity: EthicsSeverity;
  readonly source: string;
  readonly examples: ReadonlyArray<string>;
}

export const BRIGNULL_TAXONOMY: ReadonlyArray<BrignullCategorySpec> = Object.freeze([
  {
    type: 'sneaking',
    displayName: 'Sneaking',
    description: 'Hiding, disguising, or delaying information relevant to the user (e.g. additional items added to cart).',
    severity: 'high',
    source: 'Brignull 2010; DSA Art. 25',
    examples: ['adds insurance to cart pre-checked', 'auto-renew without disclosure'],
  },
  {
    type: 'urgency',
    displayName: 'False urgency',
    description: 'Imposing real or fake deadlines to pressure user action ("expires in 5 min").',
    severity: 'high',
    source: 'Mathur et al. 2019; FTC 2022',
    examples: ['Only 2 left — book now!', 'Offer ends in 03:14'],
  },
  {
    type: 'misdirection',
    displayName: 'Misdirection',
    description: 'Visually steering the user toward the choice the operator prefers.',
    severity: 'high',
    source: 'Brignull 2010',
    examples: ['"Subscribe" button styled prominent vs "No thanks" tiny link'],
  },
  {
    type: 'social-proof',
    displayName: 'Deceptive social proof',
    description: 'Fake reviews, "x people just bought this" without evidence, fabricated testimonials.',
    severity: 'high',
    source: 'Mathur 2019; FTC fake-review enforcement (2024)',
    examples: ['"104 people viewing right now"'],
  },
  {
    type: 'scarcity',
    displayName: 'False scarcity',
    description: 'Claiming low stock or limited availability to provoke a purchase.',
    severity: 'medium',
    source: 'Mathur 2019',
    examples: ['"Only 1 left at this price"'],
  },
  {
    type: 'obstruction',
    displayName: 'Obstruction',
    description: 'Making a task (typically cancellation or opt-out) deliberately difficult.',
    severity: 'critical',
    source: 'Brignull 2010; FTC Click-to-Cancel Rule 2024',
    examples: ['cancel only via phone call', 'multi-page unsubscribe flow'],
  },
  {
    type: 'forced-action',
    displayName: 'Forced action',
    description: 'Requiring the user to do something tangential (sign up, share data) to complete a goal.',
    severity: 'high',
    source: 'Brignull 2010; GDPR Art. 7(4)',
    examples: ['create account to view price', 'must agree to marketing to proceed'],
  },
  {
    type: 'roach-motel',
    displayName: 'Roach motel',
    description: 'Easy in, hard out — e.g. one-click signup, multi-step cancel.',
    severity: 'critical',
    source: 'Brignull 2010',
    examples: ['signup 1 click; cancel requires calling support'],
  },
  {
    type: 'privacy-zuckering',
    displayName: 'Privacy zuckering',
    description: 'Tricking users into sharing more personal data than they intended.',
    severity: 'critical',
    source: 'Brignull 2010; GDPR Art. 5 / DPC Meta enforcement',
    examples: ['pre-checked "share with partners" box', 'continue with Facebook → grants email + posts'],
  },
  {
    type: 'price-comparison-prevention',
    displayName: 'Price comparison prevention',
    description: 'Making it difficult to compare prices across competitors or product variants.',
    severity: 'medium',
    source: 'Brignull 2010',
    examples: ['monthly price shown but only annual billing in checkout'],
  },
  {
    type: 'hidden-costs',
    displayName: 'Hidden costs',
    description: 'Costs (taxes, fees, shipping) revealed only at the last checkout step.',
    severity: 'high',
    source: 'EU Directive 2011/83/EU Art. 6; FTC Junk Fees Rule 2024',
    examples: ['$5/mo headline; +$3 "service fee" only at checkout'],
  },
  {
    type: 'bait-and-switch',
    displayName: 'Bait and switch',
    description: 'User sets out to do X but is given Y instead.',
    severity: 'critical',
    source: 'Brignull 2010; FTC enforcement actions',
    examples: ['"X" button on dialog actually triggers signup'],
  },
  {
    type: 'confirmshaming',
    displayName: 'Confirmshaming',
    description: 'Guilt-tripping the user into opting in.',
    severity: 'medium',
    source: 'Brignull 2010',
    examples: ['"No thanks, I don\'t want to save money"'],
  },
  {
    type: 'disguised-ads',
    displayName: 'Disguised ads',
    description: 'Adverts dressed as content, navigation, or system UI.',
    severity: 'high',
    source: 'FTC .com Disclosures 2013; FTC Native Advertising Guides',
    examples: ['"Download" button that is an ad for unrelated app'],
  },
]);

export function specFor(type: BrignullDarkPattern): BrignullCategorySpec {
  const spec = BRIGNULL_TAXONOMY.find((t) => t.type === type);
  if (!spec) {
    throw new Error(`[ethics-framework/dark-patterns] unknown type '${type}'`);
  }
  return spec;
}
