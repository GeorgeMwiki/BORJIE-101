/**
 * Mineral Royalty Statement — builder.
 *
 * Validates request data, computes the royalty + inspection-fee per
 * shipment and the statement totals, pre-formats every monetary figure
 * via the project `formatCurrency` convention, selects a single-language
 * label set (EN/SW absolute toggle), then renders to PDF through the
 * Typst renderer. Citation enrichment + WORM logging happen one layer up
 * in `studio.generate()`.
 */

import {
  MIME_TYPES,
  type DocFormat,
  type RenderedArtifact,
  type Renderer,
} from '../../types.js';
import { sha256Hex } from '../../citations/citation-verifier.js';
import { formatCurrency, formatNumber, roundMoney } from '../../format.js';
import {
  RoyaltyStatementDataSchema,
  type DocLocale,
  type RoyaltyStatementData,
} from './data-schema.js';
import { pickRoyaltyLabels } from './labels.js';

export const ROYALTY_STATEMENT_TEMPLATE_REF = 'royalty-statement/template.typ';

export const ROYALTY_STATEMENT_DEFAULT_FORMATS: ReadonlyArray<DocFormat> =
  Object.freeze(['pdf']);

export interface RoyaltyStatementBuildInput {
  readonly data: unknown;
  readonly formats?: ReadonlyArray<DocFormat>;
  readonly renderer: Renderer;
}

function localeTag(locale: DocLocale): string {
  return locale === 'sw' ? 'sw-TZ' : 'en';
}

/** Pure transform → the exact JSON the Typst template consumes. */
export function toRoyaltyStatementView(data: RoyaltyStatementData) {
  const tag = localeTag(data.locale);
  const labels = pickRoyaltyLabels(data.locale);
  const money = (n: number): string =>
    formatCurrency(n, data.currencyCode, { locale: tag });
  const num = (n: number): string => formatNumber(n, { locale: tag });

  let totalGross = 0;
  let totalRoyalty = 0;
  let totalInspection = 0;

  const shipments = data.shipments.map((s) => {
    const royalty = roundMoney((s.grossValue * s.royaltyRatePct) / 100);
    const inspection = roundMoney(
      (s.grossValue * (s.inspectionFeeRatePct ?? 0)) / 100,
    );
    totalGross += s.grossValue;
    totalRoyalty += royalty;
    totalInspection += inspection;
    return {
      ref: s.shipmentRef,
      date: s.date,
      mineral: s.mineral,
      quantity: `${num(s.quantity)} ${s.unit}`,
      grade: s.grade ?? '',
      grossValue: money(s.grossValue),
      rate: `${num(s.royaltyRatePct)}%`,
      royalty: money(royalty),
    };
  });

  totalGross = roundMoney(totalGross);
  totalRoyalty = roundMoney(totalRoyalty);
  totalInspection = roundMoney(totalInspection);
  const totalPayable = roundMoney(totalRoyalty + totalInspection);

  return {
    locale: data.locale,
    labels,
    producer: { ...data.producer },
    statement: { ...data.statement },
    shipments,
    hasInspection: totalInspection > 0,
    totals: {
      totalGrossValue: money(totalGross),
      totalRoyalty: money(totalRoyalty),
      totalInspection: money(totalInspection),
      totalPayable: money(totalPayable),
    },
    citations: data.citations.map((c) => ({
      id: c.id,
      claim: c.claim,
      ref: c.source.ref,
    })),
  };
}

export async function buildRoyaltyStatement(
  input: RoyaltyStatementBuildInput,
): Promise<ReadonlyArray<RenderedArtifact>> {
  const data: RoyaltyStatementData = RoyaltyStatementDataSchema.parse(
    input.data,
  );
  const formats =
    input.formats && input.formats.length > 0
      ? input.formats
      : ROYALTY_STATEMENT_DEFAULT_FORMATS;

  const view = toRoyaltyStatementView(data);

  const artifacts: RenderedArtifact[] = [];
  for (const format of formats) {
    if (format !== 'pdf') {
      throw new Error(`Royalty statement supports pdf only; got ${format}`);
    }
    const rendered = await input.renderer.render({
      templateRef: ROYALTY_STATEMENT_TEMPLATE_REF,
      format,
      data: view,
    });
    if (rendered.error) {
      throw new Error(
        `Royalty statement render failed (${rendered.error.code}): ${rendered.error.message}`,
      );
    }
    artifacts.push({
      format,
      mimeType: rendered.mimeType ?? MIME_TYPES[format],
      buffer: rendered.buffer,
      sha256: sha256Hex(rendered.buffer),
    });
  }
  return artifacts;
}
