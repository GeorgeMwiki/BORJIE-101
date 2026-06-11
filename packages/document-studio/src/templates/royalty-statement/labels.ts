/**
 * Mineral Royalty Statement — single-language label sets.
 *
 * EN/SW absolute toggle (CLAUDE.md hard rail): the builder picks ONE
 * dictionary by locale; the Typst template renders only `data.labels.*`,
 * so the document cannot mix languages. Both dictionaries are complete.
 */

import type { DocLocale } from './data-schema.js';

export interface RoyaltyStatementLabels {
  readonly title: string;
  readonly statuteLine: string;
  readonly statementNo: string;
  readonly period: string;
  readonly dateIssued: string;

  readonly secProducer: string;
  readonly name: string;
  readonly licenceNo: string;
  readonly tin: string;
  readonly address: string;

  readonly secShipments: string;
  readonly colRef: string;
  readonly colDate: string;
  readonly colMineral: string;
  readonly colQuantity: string;
  readonly colGrossValue: string;
  readonly colRate: string;
  readonly colRoyalty: string;

  readonly secTotals: string;
  readonly totalGrossValue: string;
  readonly totalRoyalty: string;
  readonly totalInspection: string;
  readonly totalPayable: string;

  readonly issuedBy: string;
  readonly signature: string;
  readonly citationsTitle: string;
  readonly advisoryNote: string;
}

const EN: RoyaltyStatementLabels = {
  title: 'Mineral Royalty Statement',
  statuteLine: 'Royalty assessed under the Mining Act, 2010',
  statementNo: 'Statement no.',
  period: 'Period',
  dateIssued: 'Date issued',

  secProducer: 'Producer / licence holder',
  name: 'Name',
  licenceNo: 'Licence no.',
  tin: 'TIN',
  address: 'Address',

  secShipments: 'Per-shipment royalty computation',
  colRef: 'Shipment',
  colDate: 'Date',
  colMineral: 'Mineral',
  colQuantity: 'Quantity',
  colGrossValue: 'Gross value',
  colRate: 'Rate',
  colRoyalty: 'Royalty',

  secTotals: 'Totals',
  totalGrossValue: 'Total gross value',
  totalRoyalty: 'Total royalty',
  totalInspection: 'Total inspection fee',
  totalPayable: 'Total royalty payable',

  issuedBy: 'Issued by',
  signature: 'Signature',
  citationsTitle: 'Citations and sources',
  advisoryNote:
    'This statement is computed by Borjie from shipment records for ' +
    'review. Figures are advisory and require verification against the ' +
    'Mining Commission’s assessment before payment.',
};

const SW: RoyaltyStatementLabels = {
  title: 'Taarifa ya Mrabaha wa Madini',
  statuteLine: 'Mrabaha umekokotolewa kwa mujibu wa Sheria ya Madini, 2010',
  statementNo: 'Namba ya taarifa',
  period: 'Kipindi',
  dateIssued: 'Tarehe ya kutolewa',

  secProducer: 'Mzalishaji / mwenye leseni',
  name: 'Jina',
  licenceNo: 'Namba ya leseni',
  tin: 'TIN',
  address: 'Anuani',

  secShipments: 'Ukokotoaji wa mrabaha kwa kila usafirishaji',
  colRef: 'Usafirishaji',
  colDate: 'Tarehe',
  colMineral: 'Madini',
  colQuantity: 'Kiasi',
  colGrossValue: 'Thamani ya jumla',
  colRate: 'Kiwango',
  colRoyalty: 'Mrabaha',

  secTotals: 'Majumuisho',
  totalGrossValue: 'Jumla ya thamani',
  totalRoyalty: 'Jumla ya mrabaha',
  totalInspection: 'Jumla ya ada ya ukaguzi',
  totalPayable: 'Jumla ya mrabaha inayolipwa',

  issuedBy: 'Imetolewa na',
  signature: 'Sahihi',
  citationsTitle: 'Marejeo na vyanzo',
  advisoryNote:
    'Taarifa hii imekokotolewa na Borjie kutoka kumbukumbu za usafirishaji ' +
    'kwa ajili ya mapitio. Takwimu ni za ushauri na zinahitaji uthibitisho ' +
    'dhidi ya tathmini ya Tume ya Madini kabla ya malipo.',
};

export function pickRoyaltyLabels(locale: DocLocale): RoyaltyStatementLabels {
  return locale === 'sw' ? SW : EN;
}
