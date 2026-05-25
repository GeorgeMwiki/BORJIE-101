/**
 * Schema-mirror test — locks the local `PORTAL_DASHBOARD_KIND_NAMES`
 * list in sync with `@borjie/genui`'s `PORTAL_DASHBOARD_KINDS`.
 *
 * If a new AG-UI primitive is added to `packages/genui/src/document.ts`
 * but NOT mirrored here, this test fails — the engineer who added it
 * is then nudged to update this list and any consumer code.
 *
 * Reads the genui source file as TEXT (not via import) because the
 * genui package re-exports React components which would force us to
 * enable JSX in this Node-only package.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PORTAL_DASHBOARD_KIND_NAMES } from '../types.js';

describe('PORTAL_DASHBOARD_KIND_NAMES mirror', () => {
  it('matches @borjie/genui/document.ts PORTAL_DASHBOARD_KINDS', () => {
    const docPath = resolve(
      __dirname,
      '..',
      '..',
      '..',
      'genui',
      'src',
      'document.ts',
    );
    const source = readFileSync(docPath, 'utf8');
    const match = source.match(
      /export const PORTAL_DASHBOARD_KINDS = \[([\s\S]*?)\] as const;/,
    );
    expect(match, 'PORTAL_DASHBOARD_KINDS not found').toBeTruthy();
    const upstream = (match![1].match(/'([^']+)'/g) ?? []).map((s) =>
      s.replace(/^'(.*)'$/, '$1'),
    );
    expect(upstream).toEqual([...PORTAL_DASHBOARD_KIND_NAMES]);
  });
});
