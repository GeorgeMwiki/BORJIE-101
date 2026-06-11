/**
 * Mining Licence Application — builder.
 *
 * Validates request data, computes statutory totals, pre-formats every
 * monetary figure via the project `formatCurrency` convention, selects a
 * single-language label set (EN/SW absolute toggle), then renders to PDF
 * through the Typst renderer. Citation enrichment + WORM logging happen
 * one layer up in `studio.generate()`.
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
  LicenceApplicationDataSchema,
  type DocLocale,
  type LicenceApplicationData,
} from './data-schema.js';
import { pickLicenceLabels } from './labels.js';

export const LICENCE_APPLICATION_TEMPLATE_REF =
  'licence-application/template.typ';

export const LICENCE_APPLICATION_DEFAULT_FORMATS: ReadonlyArray<DocFormat> =
  Object.freeze(['pdf']);

export interface LicenceApplicationBuildInput {
  readonly data: unknown;
  readonly formats?: ReadonlyArray<DocFormat>;
  readonly renderer: Renderer;
}

/** BCP-47 locale used only for digit grouping. */
function localeTag(locale: DocLocale): string {
  return locale === 'sw' ? 'sw-TZ' : 'en';
}

/** Pure transform → the exact JSON the Typst template consumes. */
export function toLicenceApplicationView(data: LicenceApplicationData) {
  const tag = localeTag(data.locale);
  const labels = pickLicenceLabels(data.locale);
  const money = (n: number): string =>
    formatCurrency(n, data.currencyCode, { locale: tag });
  const num = (n: number): string => formatNumber(n, { locale: tag });

  const totalAnnualRent = roundMoney(
    data.fees.annualRentPerHectare * data.licence.areaHectares,
  );
  const preparationFee = data.fees.preparationFee ?? 0;
  const totalPayable = roundMoney(
    data.fees.applicationFee + totalAnnualRent + preparationFee,
  );

  const licenceTypeDisplay =
    data.licence.type === 'PML' ? labels.licenceTypePml : labels.licenceTypePl;
  const applicantTypeDisplay =
    data.applicant.applicantType === 'company'
      ? labels.applicantCompany
      : labels.applicantIndividual;

  return {
    locale: data.locale,
    labels,
    licenceTypeDisplay,
    applicantTypeDisplay,
    applicant: {
      name: data.applicant.name,
      idTin: data.applicant.nationalIdOrTin,
      nationality: data.applicant.nationality,
      address: data.applicant.address,
      companyRegNo: data.applicant.companyRegNo ?? '',
    },
    licence: {
      primaryMineral: data.licence.primaryMineral,
      otherMinerals: (data.licence.otherMinerals ?? []).join(', '),
      areaHectares: num(data.licence.areaHectares),
      durationYears: String(data.licence.durationYears),
      region: data.licence.region,
      district: data.licence.district,
      ward: data.licence.ward ?? '',
      localityDescription: data.licence.localityDescription,
    },
    beacons: data.beacons.map((b) => ({
      beaconNo: b.beaconNo,
      latitude: b.latitude.toFixed(6),
      longitude: b.longitude.toFixed(6),
    })),
    workProgramme: {
      summary: data.workProgramme.summary,
      proposedExpenditure: money(data.workProgramme.proposedExpenditure),
      equipment: (data.workProgramme.equipment ?? []).join(', '),
      estimatedJobs:
        data.workProgramme.estimatedJobs === undefined
          ? ''
          : num(data.workProgramme.estimatedJobs),
    },
    fees: {
      applicationFee: money(data.fees.applicationFee),
      annualRentPerHa: money(data.fees.annualRentPerHectare),
      totalAnnualRent: money(totalAnnualRent),
      preparationFee:
        data.fees.preparationFee === undefined
          ? ''
          : money(data.fees.preparationFee),
      totalPayable: money(totalPayable),
    },
    submission: {
      referenceNo: data.submission.referenceNo,
      dateSubmitted: data.submission.dateSubmitted,
      submittedBy: data.submission.submittedBy,
    },
    citations: data.citations.map((c) => ({
      id: c.id,
      claim: c.claim,
      ref: c.source.ref,
    })),
  };
}

export async function buildLicenceApplication(
  input: LicenceApplicationBuildInput,
): Promise<ReadonlyArray<RenderedArtifact>> {
  const data: LicenceApplicationData = LicenceApplicationDataSchema.parse(
    input.data,
  );
  const formats =
    input.formats && input.formats.length > 0
      ? input.formats
      : LICENCE_APPLICATION_DEFAULT_FORMATS;

  const view = toLicenceApplicationView(data);

  const artifacts: RenderedArtifact[] = [];
  for (const format of formats) {
    if (format !== 'pdf') {
      throw new Error(`Licence application supports pdf only; got ${format}`);
    }
    const rendered = await input.renderer.render({
      templateRef: LICENCE_APPLICATION_TEMPLATE_REF,
      format,
      data: view,
    });
    if (rendered.error) {
      throw new Error(
        `Licence application render failed (${rendered.error.code}): ${rendered.error.message}`,
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
