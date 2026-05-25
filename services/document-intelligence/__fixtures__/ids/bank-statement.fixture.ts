/**
 * Fixture: Bank statement header (CRDB bank, Tanzania).
 * Only identity/address fields used by the extraction pipeline.
 */

import type { OcrFixture } from './tanzania-nida.fixture.js';

export const bankStatementFixture: OcrFixture = {
  key: 'bank_statement',
  documentType: 'bank_statement',
  rawText:
    'CRDB BANK PLC\n' +
    'Account Holder: JOHN KAMAU WANJIRU\n' +
    'Account Number: 0150-4567-8901\n' +
    'Branch: WESTLANDS\n' +
    'Statement Period: 01 Feb 2025 - 28 Feb 2025\n' +
    'Mailing Address: PO Box 12345, Westlands Road, NAIROBI, Kenya\n' +
    'Closing Balance: KES 245,300.00',
  structuredData: {
    documentType: 'bank_statement',
    institution: 'CRDB Bank',
    country: 'KE',
  },
  fields: [
    {
      fieldName: 'full_name',
      value: 'JOHN KAMAU WANJIRU',
      confidence: 0.95,
      boundingBox: { left: 100, top: 90, width: 320, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'address_line1',
      value: 'PO Box 12345, Westlands Road',
      confidence: 0.87,
      boundingBox: { left: 100, top: 150, width: 360, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'city',
      value: 'NAIROBI',
      confidence: 0.93,
      boundingBox: { left: 100, top: 180, width: 180, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'country',
      value: 'Kenya',
      confidence: 0.95,
      boundingBox: null,
      normalized: true,
      validationStatus: 'valid',
    },
  ],
  averageConfidence: 0.92,
  pageCount: 2,
};
