/**
 * Fixture: Tanzanian NIDA (National Identification Authority) card.
 * No image binary — only the expected extraction envelope.
 */

import type { ExtractedField } from '../../src/types/index.js';

export interface OcrFixture {
  readonly key: string;
  readonly documentType: string;
  readonly rawText: string;
  readonly structuredData: Record<string, unknown>;
  readonly fields: readonly ExtractedField[];
  readonly averageConfidence: number;
  readonly pageCount: number;
}

export const tanzaniaNidaFixture: OcrFixture = {
  key: 'tanzania_nida',
  documentType: 'national_id',
  rawText:
    'THE UNITED REPUBLIC OF TANZANIA\n' +
    'NATIONAL IDENTIFICATION AUTHORITY\n' +
    'Full Name: AMINA HASSAN MWINYI\n' +
    'ID No: 19870412-12345-67890-01\n' +
    'Date of Birth: 12/04/1987\n' +
    'Sex: F\n' +
    'Nationality: TANZANIAN\n' +
    'Issue Date: 15/06/2020\n' +
    'Expiry Date: 15/06/2030',
  structuredData: {
    documentType: 'national_id',
    country: 'TZ',
    issuer: 'NIDA',
  },
  fields: [
    {
      fieldName: 'full_name',
      value: 'AMINA HASSAN MWINYI',
      confidence: 0.96,
      boundingBox: { left: 120, top: 80, width: 320, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'id_number',
      value: '19870412-12345-67890-01',
      confidence: 0.94,
      boundingBox: { left: 120, top: 120, width: 360, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'date_of_birth',
      value: '1987-04-12',
      confidence: 0.92,
      boundingBox: { left: 120, top: 160, width: 180, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'gender',
      value: 'F',
      confidence: 0.97,
      boundingBox: { left: 120, top: 200, width: 40, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'nationality',
      value: 'Tanzanian',
      confidence: 0.95,
      boundingBox: { left: 120, top: 240, width: 200, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'issue_date',
      value: '2020-06-15',
      confidence: 0.9,
      boundingBox: { left: 120, top: 280, width: 180, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'expiry_date',
      value: '2030-06-15',
      confidence: 0.9,
      boundingBox: { left: 120, top: 320, width: 180, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
  ],
  averageConfidence: 0.93,
  pageCount: 1,
};
