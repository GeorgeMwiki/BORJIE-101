/**
 * Local copy of CSPRNG ID helper so reports service does not reach across
 * package boundaries. Mirrors services/domain-services/src/common/id-generator.ts.
 */

import { randomBytes } from 'node:crypto';

export function randomHex(byteLength = 4): string {
  return randomBytes(byteLength).toString('hex');
}
