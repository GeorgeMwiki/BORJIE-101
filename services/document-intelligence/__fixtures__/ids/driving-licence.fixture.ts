/**
 * Fixture: East African driving licence (Tanzania format).
 */

import type { OcrFixture } from './tanzania-nida.fixture.js';

export const drivingLicenceFixture: OcrFixture = {
  key: 'driving_licence',
  documentType: 'drivers_license',
  rawText:
    'UNITED REPUBLIC OF TANZANIA\n' +
    'DRIVING LICENCE\n' +
    'Surname: MWANGI\n' +
    'Other Names: PETER JAMES\n' +
    'Licence No: DL-TZ-2021-887766\n' +
    'Class: B\n' +
    'Date of Birth: 22.03.1985\n' +
    'Date of Issue: 01.02.2021\n' +
    'Date of Expiry: 01.02.2026',
  structuredData: {
    documentType: 'drivers_license',
    country: 'TZ',
    class: 'B',
  },
  fields: [
    {
      fieldName: 'last_name',
      value: 'MWANGI',
      confidence: 0.96,
      boundingBox: { left: 130, top: 70, width: 180, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'first_name',
      value: 'PETER JAMES',
      confidence: 0.94,
      boundingBox: { left: 130, top: 100, width: 220, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'full_name',
      value: 'PETER JAMES MWANGI',
      confidence: 0.93,
      boundingBox: null,
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'id_number',
      value: 'DL-TZ-2021-887766',
      confidence: 0.95,
      boundingBox: { left: 130, top: 130, width: 280, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'date_of_birth',
      value: '1985-03-22',
      confidence: 0.9,
      boundingBox: { left: 130, top: 160, width: 180, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'issue_date',
      value: '2021-02-01',
      confidence: 0.92,
      boundingBox: { left: 130, top: 190, width: 180, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'expiry_date',
      value: '2026-02-01',
      confidence: 0.92,
      boundingBox: { left: 130, top: 220, width: 180, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
  ],
  averageConfidence: 0.93,
  pageCount: 1,
};
