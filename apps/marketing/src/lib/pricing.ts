import type { Locale } from './i18n';

/**
 * Canonical Borjie pricing tiers — shared between the landing
 * `Pricing` section and the dedicated `/pricing` comparison page so the
 * monthly fee, quotas, and CTA copy never drift across surfaces.
 *
 * Per spec the five tier names (Mwanzo · Mkulima · Mfanyabiashara ·
 * Kampuni · Group) ship verbatim in both Swahili and English UIs.
 */

export type PricingTierId = 'mwanzo' | 'mkulima' | 'mfanyabiashara' | 'kampuni' | 'group';

export type PricingTier = {
  readonly id: PricingTierId;
  readonly name: string;
  readonly price: string;
  readonly unit: string;
  readonly tagline: { readonly sw: string; readonly en: string };
  readonly highlighted: boolean;
  readonly features: { readonly sw: ReadonlyArray<string>; readonly en: ReadonlyArray<string> };
  readonly cta: { readonly sw: string; readonly en: string };
  readonly href: string;
};

export const TIERS: ReadonlyArray<PricingTier> = [
  {
    id: 'mwanzo',
    name: 'Mwanzo',
    price: 'TZS 0',
    unit: 'mo',
    tagline: { sw: 'Kwa mchimbaji wa kwanza', en: 'For first-time miners' },
    highlighted: false,
    features: {
      sw: [
        '1 mmiliki',
        '1 site',
        '10 nyaraka kwa mwezi',
        'Msaada wa jumuiya',
        'Master Brain · advise mode',
      ],
      en: [
        '1 owner',
        '1 site',
        '10 docs/mo',
        'Community support',
        'Master Brain · advise mode',
      ],
    },
    cta: { sw: 'Anza bure', en: 'Start free' },
    href: '/pilot',
  },
  {
    id: 'mkulima',
    name: 'Mkulima',
    price: 'TZS 150,000',
    unit: 'mo',
    tagline: { sw: 'Kwa wachimbaji wadogo', en: 'For artisanal operators' },
    highlighted: false,
    features: {
      sw: [
        '3 watumiaji',
        '3 sites',
        '100 nyaraka kwa mwezi',
        'Msaada wa WhatsApp',
        'Licence calendar + daily brief',
      ],
      en: [
        '3 users',
        '3 sites',
        '100 docs/mo',
        'WhatsApp support',
        'Licence calendar + daily brief',
      ],
    },
    cta: { sw: 'Chagua Mkulima', en: 'Choose Mkulima' },
    href: '/pilot',
  },
  {
    id: 'mfanyabiashara',
    name: 'Mfanyabiashara',
    price: 'TZS 500,000',
    unit: 'mo',
    tagline: { sw: 'Kwa wafanyabiashara wa madini', en: 'For trading operators' },
    highlighted: true,
    features: {
      sw: [
        '10 watumiaji',
        '10 sites',
        'Nyaraka bila kikomo',
        'Email + WhatsApp support',
        'Drill-hole logger + FX & treasury',
        'Marketplace + KYC otomatiki',
      ],
      en: [
        '10 users',
        '10 sites',
        'Unlimited docs',
        'Email + WhatsApp support',
        'Drill-hole logger + FX & treasury',
        'Marketplace + auto KYC',
      ],
    },
    cta: { sw: 'Chagua Mfanyabiashara', en: 'Choose Mfanyabiashara' },
    href: '/pilot',
  },
  {
    id: 'kampuni',
    name: 'Kampuni',
    price: 'TZS 1,500,000',
    unit: 'mo',
    tagline: { sw: 'Kwa kampuni kubwa', en: 'For corporate operators' },
    highlighted: false,
    features: {
      sw: [
        '50 watumiaji',
        'Sites bila kikomo',
        'Dedicated success manager',
        'Integrations za kawaida',
        'Compliance pack + audit chain export',
      ],
      en: [
        '50 users',
        'Unlimited sites',
        'Dedicated success manager',
        'Custom integrations',
        'Compliance pack + audit chain export',
      ],
    },
    cta: { sw: 'Ongea na timu', en: 'Talk to the team' },
    href: '/pilot',
  },
  {
    id: 'group',
    name: 'Group',
    price: 'Bespoke',
    unit: '',
    tagline: { sw: 'Kwa portfolio ya kampuni nyingi', en: 'For multi-company portfolios' },
    highlighted: false,
    features: {
      sw: [
        'Multi-company portfolio',
        'White-glove migration',
        'SLA iliyoandikwa',
        'On-prem au private cloud',
        'Named support engineer',
      ],
      en: [
        'Multi-company portfolio',
        'White-glove migration',
        'Contractual SLA',
        'On-prem or private cloud',
        'Named support engineer',
      ],
    },
    cta: { sw: 'Tuwasiliane', en: 'Talk to us' },
    href: '/pilot',
  },
];

export function tierFeatures(tier: PricingTier, locale: Locale): ReadonlyArray<string> {
  return tier.features[locale] ?? tier.features.en;
}

export function tierTagline(tier: PricingTier, locale: Locale): string {
  return tier.tagline[locale] ?? tier.tagline.en;
}

export function tierCta(tier: PricingTier, locale: Locale): string {
  return tier.cta[locale] ?? tier.cta.en;
}
