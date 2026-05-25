/**
 * Test fixture loader — reads the synthetic .txt fixtures.
 *
 * Why .txt and not real .pdf:
 *   - The production OCR/PDF path is a lazy import that we test
 *     contractually (extract-text returns the same shape regardless).
 *   - Synthetic fixtures keep the test suite hermetic + fast.
 *   - The integration coverage flows through layout + extract + route
 *     unchanged — the only diff is the OCR stage produces text directly.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(here, '..', '..', 'test-fixtures');

export type FixtureName =
  | 'lease-application'
  | 'payment-receipt-gepg'
  | 'national-id-nida'
  | 'condition-survey'
  | 'complaint-letter';

const FILES: Record<FixtureName, string> = {
  'lease-application': 'lease-application.txt',
  'payment-receipt-gepg': 'payment-receipt-gepg.txt',
  'national-id-nida': 'national-id-nida.txt',
  'condition-survey': 'condition-survey.txt',
  'complaint-letter': 'complaint-letter.txt',
};

export function loadFixture(name: FixtureName): string {
  const path = join(FIXTURES_DIR, FILES[name]);
  return readFileSync(path, 'utf8');
}

export const ALL_FIXTURES: ReadonlyArray<FixtureName> = [
  'lease-application',
  'payment-receipt-gepg',
  'national-id-nida',
  'condition-survey',
  'complaint-letter',
];
