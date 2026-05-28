/**
 * Marketing and brand — 8 sub-areas covering the public face of the
 * business, NOT just promotion.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 5.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'brand_mentions',
    label: { en: 'Brand mentions (press, social, podcasts, industry forums)', sw: 'Kutajwa kwa chapa' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'A negative press cycle missed for 24 hours doubles in reach by day three.',
      sw: 'Mzunguko hasi wa habari usiojulikana kwa saa 24 unaongeza maradufu.',
    },
    dataResolverKey: 'marketing.brand_mentions',
  },
  {
    id: 'counterparty_perception',
    label: { en: 'Counterparty perception (buyer, refiner, off-taker NPS)', sw: 'Mtazamo wa mhusika mwingine' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Buyer dissatisfaction unsurfaced for a quarter erodes the next sales pipeline.',
      sw: 'Kutoridhika kwa mnunuzi kusiko juu kwa robo kunadhoofisha mfumo wa mauzo.',
    },
    dataResolverKey: 'marketing.counterparty_perception',
  },
  {
    id: 'community_sentiment',
    label: { en: 'Community sentiment (village CDA monitoring)', sw: 'Hisia za jamii' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'A souring village creates the conditions for an artisanal-miner incursion.',
      sw: 'Kijiji kinachochukia kinaleta hali za uvamizi.',
    },
    dataResolverKey: 'marketing.community_sentiment',
  },
  {
    id: 'investor_communications',
    label: { en: 'Investor communications (board pack, AGM, disclosures)', sw: 'Mawasiliano ya wawekezaji' },
    cadence: 'quarterly',
    riskIfMissed: {
      en: 'Late board packs erode investor trust and bargaining power.',
      sw: 'Vifurushi vya bodi vya kuchelewa vinapunguza imani ya wawekezaji.',
    },
    dataResolverKey: 'marketing.investor_communications',
  },
  {
    id: 'trade_show_participation',
    label: { en: 'Trade-show participation (Mining Indaba, PDAC, AMCOS forums)', sw: 'Kushiriki kwenye maonyesho ya biashara' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Skipping Mining Indaba leaves Tanzanian operators invisible to global capital.',
      sw: 'Kuruka Mining Indaba kunaacha waendeshaji wa Tanzania bila kuonekana.',
    },
    dataResolverKey: 'marketing.trade_show_participation',
  },
  {
    id: 'pr_crisis_log',
    label: { en: 'PR crisis log', sw: 'Rejesta ya migogoro ya PR' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Unmanaged crises become a Wikipedia footnote that follows the brand.',
      sw: 'Migogoro isiyodhibitiwa inakuwa rekodi ya kudumu.',
    },
    dataResolverKey: 'marketing.pr_crisis_log',
  },
  {
    id: 'marketplace_listings_reputation',
    label: { en: 'Marketplace listings reputation (dispute rate, refund rate)', sw: 'Sifa ya orodha za soko' },
    cadence: 'monthly',
    riskIfMissed: {
      en: 'A rising dispute rate signals a counterparty problem before it shows in cash.',
      sw: 'Kiwango cha migogoro kinachoongezeka kinaashiria tatizo kabla hakijaonekana kifedha.',
    },
    dataResolverKey: 'marketing.marketplace_listings_reputation',
  },
  {
    id: 'digital_footprint',
    label: { en: 'Digital footprint (portal, app, web)', sw: 'Uwepo wa kidijitali' },
    cadence: 'weekly',
    riskIfMissed: {
      en: 'Falling app engagement is the leading indicator of customer churn.',
      sw: 'Kushuka kwa matumizi ya programu ni dalili ya kupotea kwa wateja.',
    },
    dataResolverKey: 'marketing.digital_footprint',
  },
]);

export const MARKETING_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'marketing',
  label: { en: 'Marketing and brand', sw: 'Masoko na chapa' },
  headline: {
    en: 'Full reputation picture: 8 sub-areas spanning press, community, investors and digital.',
    sw: 'Picha kamili ya sifa: maeneo 8.',
  },
  subAreas: SUB_AREAS,
});
