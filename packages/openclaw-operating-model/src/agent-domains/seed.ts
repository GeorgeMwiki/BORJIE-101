/**
 * Bulk-seed the pre-shipped domain catalog into an AgentRegistry.
 */

import type { AgentRegistry } from '../types.js';
import { SHIPPED_DOMAINS } from './catalog.js';

export async function seedShippedDomains(
  registry: AgentRegistry,
): Promise<number> {
  let count = 0;
  for (const domain of SHIPPED_DOMAINS) {
    await registry.registerDomain(domain);
    count += 1;
  }
  return count;
}
