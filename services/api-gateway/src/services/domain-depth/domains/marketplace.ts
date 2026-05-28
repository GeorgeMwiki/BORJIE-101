/**
 * Marketplace — 9 sub-areas covering the full chain-of-custody and the
 * counterparty cycle, NOT just listings.
 *
 * Source: `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` section 9.
 */

import type { DomainDescriptor, SubAreaDescriptor } from '../types';

const SUB_AREAS: ReadonlyArray<SubAreaDescriptor> = Object.freeze([
  {
    id: 'active_listings',
    label: { en: 'Active listings (parcels, grade, ask, days)', sw: 'Orodha zinazofanya kazi' },
    cadence: 'real-time',
    riskIfMissed: {
      en: 'A parcel listed without a current ask drifts to a discount.',
      sw: 'Kifurushi kilichoorodheshwa bila bei ya sasa kinashuka kwa punguzo.',
    },
    dataResolverKey: 'marketplace.active_listings',
  },
  {
    id: 'bids_received',
    label: { en: 'Bids received (count, bid-to-ask ratio, concentration)', sw: 'Zabuni zilizopokelewa' },
    cadence: 'real-time',
    riskIfMissed: {
      en: 'Ignored bids signal the buyer is shopping elsewhere.',
      sw: 'Zabuni zilizopuuzwa zinaonyesha mnunuzi anaangalia mahali pengine.',
    },
    dataResolverKey: 'marketplace.bids_received',
  },
  {
    id: 'settlement_velocity',
    label: { en: 'Settlement velocity (list-to-cash days)', sw: 'Kasi ya malipo' },
    cadence: 'per-event',
    riskIfMissed: {
      en: 'Slow settlement ties up working capital that should be funding the next blast.',
      sw: 'Malipo polepole yanashika mtaji unaohitajika.',
    },
    dataResolverKey: 'marketplace.settlement_velocity',
  },
  {
    id: 'buyer_vetting',
    label: { en: 'Buyer vetting (KYC, ICA/LBMA, sanctions)', sw: 'Uchunguzi wa mnunuzi' },
    regulator: 'Financial Intelligence Unit (FIU)',
    cadence: 'annual',
    riskIfMissed: {
      en: 'An unvetted buyer can trigger correspondent-bank de-risking on the next USD wire.',
      sw: 'Mnunuzi asiyechunguzwa anaweza kusababisha kuondolewa na benki.',
    },
    dataResolverKey: 'marketplace.buyer_vetting',
  },
  {
    id: 'refiner_accreditation',
    label: { en: 'Refiner accreditation (LBMA good-delivery, ICA)', sw: 'Uthibitisho wa mwarefiner' },
    cadence: 'annual',
    riskIfMissed: {
      en: 'Routing dore to a non-LBMA refiner discounts the assay receipt by 5-15%.',
      sw: 'Kutuma dore kwa mwarefiner asiye LBMA kunapunguza thamani 5-15%.',
    },
    dataResolverKey: 'marketplace.refiner_accreditation',
  },
  {
    id: 'chain_of_custody',
    label: { en: 'Chain of custody (pit-to-buyer hash chain)', sw: 'Mlolongo wa umiliki' },
    cadence: 'per-parcel',
    riskIfMissed: {
      en: 'A break in chain of custody invalidates LBMA acceptance.',
      sw: 'Kuvunjika kwa mlolongo kunabatilisha LBMA.',
    },
    dataResolverKey: 'marketplace.chain_of_custody',
  },
  {
    id: 'export_documentation',
    label: { en: 'Export documentation (TRA cert, BoT, ASYCUDA)', sw: 'Hati za usafirishaji' },
    regulator: 'TRA Customs, BoT',
    cadence: 'per-shipment',
    riskIfMissed: {
      en: 'Incomplete export documents detain shipments at the border.',
      sw: 'Hati zisizokamilika zinashikilia mzigo mpakani.',
    },
    dataResolverKey: 'marketplace.export_documentation',
  },
  {
    id: 'price_benchmarks',
    label: { en: 'Price benchmarks (LBMA fix, ICA, regional comps)', sw: 'Bei za kulinganisha' },
    cadence: 'daily',
    riskIfMissed: {
      en: 'Selling without a current LBMA reference is leaving money on the table.',
      sw: 'Kuuza bila bei ya sasa ya LBMA ni kuacha pesa mezani.',
    },
    dataResolverKey: 'marketplace.price_benchmarks',
  },
  {
    id: 'dispute_refund_log',
    label: { en: 'Dispute and refund log', sw: 'Rejesta ya migogoro na marejesho' },
    cadence: 'event-driven',
    riskIfMissed: {
      en: 'Open disputes erode counterparty NPS faster than any other input.',
      sw: 'Migogoro ya wazi inadhoofisha NPS ya mhusika.',
    },
    dataResolverKey: 'marketplace.dispute_refund_log',
  },
]);

export const MARKETPLACE_DOMAIN: DomainDescriptor = Object.freeze({
  id: 'marketplace',
  label: { en: 'Marketplace', sw: 'Soko' },
  headline: {
    en: 'Full chain-of-custody and buyer-cycle picture: 9 sub-areas.',
    sw: 'Picha kamili ya mlolongo na mzunguko: maeneo 9.',
  },
  subAreas: SUB_AREAS,
});
