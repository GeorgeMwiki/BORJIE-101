/**
 * Off-take Settlement Worksheet — binder (pure view transform).
 *
 * Demonstrates the data-binding layer end-to-end:
 *   - per-line final/provisional value + balance computed from raw facts,
 *   - every monetary figure bound via `bindMoney` (formatCurrency funnel),
 *   - one single-language label set selected via `selectLabels`,
 *   - the bound `view` is what Carbone renders to XLSX/PDF.
 *
 * Citation enrichment + WORM archival happen one layer up in the studio
 * pipeline (`pipeline/studio.ts`).
 */

import {
  bindCitations,
  bindMoney,
  bindNumber,
  selectLabels,
  type DocLocale,
} from '../../registry/data-binding.js';
import { roundMoney } from '../../format.js';
import type { DocTypeSpec } from '../../registry/doc-type.js';
import {
  OfftakeSettlementDataSchema,
  type OfftakeSettlementData,
} from './data-schema.js';
import {
  OFFTAKE_SETTLEMENT_LABELS,
  type OfftakeSettlementLabels,
} from './labels.js';

export const OFFTAKE_SETTLEMENT_TEMPLATE_REF = 'offtake-settlement/template.xlsx';

/** Pure transform → the exact JSON the Carbone template consumes. */
export function toOfftakeSettlementView(data: OfftakeSettlementData): {
  readonly locale: DocLocale;
  readonly labels: OfftakeSettlementLabels;
  readonly buyer: OfftakeSettlementData['buyer'];
  readonly producer: OfftakeSettlementData['producer'];
  readonly settlement: OfftakeSettlementData['settlement'];
  readonly lines: ReadonlyArray<{
    readonly shipmentRef: string;
    readonly date: string;
    readonly mineral: string;
    readonly quantity: string;
    readonly provisionalValue: string;
    readonly finalValue: string;
    readonly advancePaid: string;
    readonly balanceDue: string;
  }>;
  readonly totals: {
    readonly totalProvisional: string;
    readonly totalFinal: string;
    readonly totalAdvance: string;
    readonly totalBalance: string;
  };
  readonly citations: ReadonlyArray<{ id: string; claim: string; ref: string }>;
} {
  const locale = data.locale;
  const cc = data.currencyCode;
  const labels = selectLabels(locale, OFFTAKE_SETTLEMENT_LABELS);

  let totProvisional = 0;
  let totFinal = 0;
  let totAdvance = 0;
  let totBalance = 0;

  const lines = data.lines.map((line) => {
    const provisionalValue = roundMoney(line.quantity * line.provisionalUnitPrice);
    const finalValue = roundMoney(line.quantity * line.finalUnitPrice);
    const balanceDue = roundMoney(finalValue - line.advancePaid);
    totProvisional += provisionalValue;
    totFinal += finalValue;
    totAdvance += line.advancePaid;
    totBalance += balanceDue;
    return {
      shipmentRef: line.shipmentRef,
      date: line.date,
      mineral: line.mineral,
      quantity: `${bindNumber(line.quantity, locale)} ${line.unit}`,
      provisionalValue: bindMoney(provisionalValue, cc, locale),
      finalValue: bindMoney(finalValue, cc, locale),
      advancePaid: bindMoney(line.advancePaid, cc, locale),
      balanceDue: bindMoney(balanceDue, cc, locale),
    };
  });

  return {
    locale,
    labels,
    buyer: data.buyer,
    producer: data.producer,
    settlement: data.settlement,
    lines,
    totals: {
      totalProvisional: bindMoney(roundMoney(totProvisional), cc, locale),
      totalFinal: bindMoney(roundMoney(totFinal), cc, locale),
      totalAdvance: bindMoney(roundMoney(totAdvance), cc, locale),
      totalBalance: bindMoney(roundMoney(totBalance), cc, locale),
    },
    citations: [...bindCitations(data.citations)],
  };
}

/** Carbone XLSX + PDF doc type for the off-take settlement worksheet. */
export const offtakeSettlementDocType: DocTypeSpec<
  OfftakeSettlementData,
  ReturnType<typeof toOfftakeSettlementView>
> = {
  id: 'offtake_settlement',
  title: 'Off-take Settlement Worksheet',
  schema: OfftakeSettlementDataSchema,
  binder: (data) => ({
    templateRef: OFFTAKE_SETTLEMENT_TEMPLATE_REF,
    view: toOfftakeSettlementView(data),
    locale: data.locale,
    currencyCode: data.currencyCode,
  }),
  engineHint: 'carbone',
  defaultFormats: ['xlsx', 'pdf'],
  // A worksheet: figures live in cells, covered by claim-match citations.
  citationMode: 'structured',
};
