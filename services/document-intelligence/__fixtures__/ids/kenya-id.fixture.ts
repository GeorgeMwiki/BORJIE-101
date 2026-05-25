/**
 * Fixture: Kenyan National ID card (Huduma Namba / standard ID).
 */

import type { OcrFixture } from './tanzania-nida.fixture.js';

export const kenyaIdFixture: OcrFixture = {
  key: 'kenya_id',
  documentType: 'national_id',
  rawText:
    'REPUBLIC OF KENYA\n' +
    'NATIONAL IDENTITY CARD\n' +
    'Full Name: JOHN KAMAU WANJIRU\n' +
    'Serial No: 12345678\n' +
    'Date of Birth: 05.09.1990\n' +
    'Sex: M\n' +
    'District of Birth: KIAMBU\n' +
    'Place of Issue: NAIROBI\n' +
    'Date of Issue: 10.11.2015',
  structuredData: {
    documentType: 'national_id',
    country: 'KE',
    issuer: 'Registrar of Persons',
  },
  fields: [
    {
      fieldName: 'full_name',
      value: 'JOHN KAMAU WANJIRU',
      confidence: 0.95,
      boundingBox: { left: 150, top: 70, width: 320, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'id_number',
      value: '12345678',
      confidence: 0.97,
      boundingBox: { left: 150, top: 110, width: 160, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'date_of_birth',
      value: '1990-09-05',
      confidence: 0.91,
      boundingBox: { left: 150, top: 150, width: 180, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'gender',
      value: 'M',
      confidence: 0.98,
      boundingBox: { left: 150, top: 190, width: 40, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'place_of_birth',
      value: 'KIAMBU',
      confidence: 0.89,
      boundingBox: { left: 150, top: 230, width: 160, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'issue_date',
      value: '2015-11-10',
      confidence: 0.9,
      boundingBox: { left: 150, top: 270, width: 180, height: 28 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'nationality',
      value: 'Kenyan',
      confidence: 0.93,
      boundingBox: null,
      normalized: true,
      validationStatus: 'valid',
    },
  ],
  averageConfidence: 0.93,
  pageCount: 1,
};
