/**
 * Fixture: Utility bill (TANESCO electricity bill).
 */

import type { OcrFixture } from './tanzania-nida.fixture.js';

export const utilityBillFixture: OcrFixture = {
  key: 'utility_bill',
  documentType: 'utility_bill',
  rawText:
    'TANESCO - TANZANIA ELECTRIC SUPPLY COMPANY\n' +
    'Customer: AMINA HASSAN MWINYI\n' +
    'Account No: 0123456789\n' +
    'Service Address: Plot 45, Kinondoni Road, DAR ES SALAAM\n' +
    'Billing Period: 01/03/2025 - 31/03/2025\n' +
    'Amount Due: TZS 48,500.00\n' +
    'Due Date: 15/04/2025',
  structuredData: {
    documentType: 'utility_bill',
    utility: 'electricity',
    country: 'TZ',
  },
  fields: [
    {
      fieldName: 'full_name',
      value: 'AMINA HASSAN MWINYI',
      confidence: 0.94,
      boundingBox: { left: 100, top: 80, width: 320, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'address_line1',
      value: 'Plot 45, Kinondoni Road',
      confidence: 0.88,
      boundingBox: { left: 100, top: 140, width: 340, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'city',
      value: 'DAR ES SALAAM',
      confidence: 0.91,
      boundingBox: { left: 100, top: 170, width: 220, height: 26 },
      normalized: true,
      validationStatus: 'valid',
    },
    {
      fieldName: 'country',
      value: 'Tanzania',
      confidence: 0.95,
      boundingBox: null,
      normalized: true,
      validationStatus: 'valid',
    },
  ],
  averageConfidence: 0.92,
  pageCount: 1,
};
