/**
 * Off-take Settlement Worksheet — single-language label sets.
 *
 * EN/SW absolute toggle (CLAUDE.md hard rail): the binder picks ONE
 * dictionary by locale; the Carbone template renders only `view.labels.*`,
 * so the worksheet cannot mix languages. Both dictionaries are complete.
 */

export interface OfftakeSettlementLabels {
  readonly title: string;
  readonly settlementNo: string;
  readonly dateIssued: string;
  readonly buyer: string;
  readonly producer: string;
  readonly reference: string;
  readonly licenceNo: string;

  readonly colShipment: string;
  readonly colDate: string;
  readonly colMineral: string;
  readonly colQuantity: string;
  readonly colProvisional: string;
  readonly colFinal: string;
  readonly colAdvance: string;
  readonly colBalance: string;

  readonly totalProvisional: string;
  readonly totalFinal: string;
  readonly totalAdvance: string;
  readonly totalBalance: string;
  readonly advisoryNote: string;
}

export const OFFTAKE_SETTLEMENT_LABELS: {
  readonly en: OfftakeSettlementLabels;
  readonly sw: OfftakeSettlementLabels;
} = {
  en: {
    title: 'Off-take Settlement Worksheet',
    settlementNo: 'Settlement no.',
    dateIssued: 'Date issued',
    buyer: 'Buyer / off-taker',
    producer: 'Producer',
    reference: 'Reference',
    licenceNo: 'Licence no.',

    colShipment: 'Shipment',
    colDate: 'Date',
    colMineral: 'Mineral',
    colQuantity: 'Quantity',
    colProvisional: 'Provisional value',
    colFinal: 'Final value',
    colAdvance: 'Advance paid',
    colBalance: 'Balance due',

    totalProvisional: 'Total provisional value',
    totalFinal: 'Total final value',
    totalAdvance: 'Total advance paid',
    totalBalance: 'Total balance due',
    advisoryNote:
      'This worksheet is computed by Borjie from shipment and assay ' +
      'records for review. Figures are advisory and require confirmation ' +
      'against the final assay certificate before settlement.',
  },
  sw: {
    title: 'Karatasi ya Malizo ya Mauzo ya Madini',
    settlementNo: 'Namba ya malizo',
    dateIssued: 'Tarehe ya kutolewa',
    buyer: 'Mnunuzi',
    producer: 'Mzalishaji',
    reference: 'Kumbukumbu',
    licenceNo: 'Namba ya leseni',

    colShipment: 'Usafirishaji',
    colDate: 'Tarehe',
    colMineral: 'Madini',
    colQuantity: 'Kiasi',
    colProvisional: 'Thamani ya awali',
    colFinal: 'Thamani ya mwisho',
    colAdvance: 'Malipo ya awali',
    colBalance: 'Salio linalodaiwa',

    totalProvisional: 'Jumla ya thamani ya awali',
    totalFinal: 'Jumla ya thamani ya mwisho',
    totalAdvance: 'Jumla ya malipo ya awali',
    totalBalance: 'Jumla ya salio linalodaiwa',
    advisoryNote:
      'Karatasi hii imekokotolewa na Borjie kutoka kumbukumbu za ' +
      'usafirishaji na uchunguzi kwa ajili ya mapitio. Takwimu ni za ' +
      'ushauri na zinahitaji uthibitisho dhidi ya cheti cha mwisho cha ' +
      'uchunguzi kabla ya malizo.',
  },
};
