// @ts-check
/**
 * production-required-parity.test.mjs
 *
 * Guards LANE 2's no-drift contract: the shared CLI source of truth
 * (scripts/lib/production-required.mjs) must list EXACTLY the same requirement
 * labels as the gateway's boot-time `PRODUCTION_REQUIRED` in
 * services/api-gateway/src/config/validate-env.ts.
 *
 * We can't import the .ts at runtime from a plain .mjs test, so we parse the TS
 * source for its `label: '...'` entries inside the PRODUCTION_REQUIRED array and
 * assert set-equality with the .mjs labels. If someone adds a new production
 * requirement to the gateway schema but forgets the CLI const (or vice-versa),
 * this fails — exactly the drift the prompt requires us to prevent.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_REQUIRED } from '../lib/production-required.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TS_PATH = resolve(
  REPO_ROOT,
  'services/api-gateway/src/config/validate-env.ts',
);

/**
 * Extract the `label` values from the TS PRODUCTION_REQUIRED array block.
 * @returns {string[]}
 */
function tsLabels() {
  const src = readFileSync(TS_PATH, 'utf8');
  const start = src.indexOf('PRODUCTION_REQUIRED');
  expect(start, 'PRODUCTION_REQUIRED not found in validate-env.ts').toBeGreaterThan(-1);
  // The findMissingProductionKeys function follows the array; bound the scan to
  // before it so we only capture array labels, not unrelated `label:` text.
  const end = src.indexOf('findMissingProductionKeys', start);
  const block = end > -1 ? src.slice(start, end) : src.slice(start);
  const labels = [];
  const re = /label:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block)) !== null) labels.push(m[1]);
  return labels;
}

describe('production-required parity (CLI const <-> gateway schema)', () => {
  it('label sets are identical', () => {
    const mjsLabels = PRODUCTION_REQUIRED.map((r) => r.label).sort();
    const fromTs = tsLabels().sort();
    expect(fromTs.length).toBeGreaterThan(0);
    expect(mjsLabels).toEqual(fromTs);
  });

  it('every requirement has at least one key and a why', () => {
    for (const req of PRODUCTION_REQUIRED) {
      expect(req.keys.length).toBeGreaterThan(0);
      expect(typeof req.why).toBe('string');
      expect(req.why.length).toBeGreaterThan(0);
      // keys[0] is the canonical name and must equal the label OR be a prefix
      // (the label is the canonical secret name).
      expect(req.keys).toContain(req.label);
    }
  });
});
