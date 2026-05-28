/**
 * Credit Reference Bureau (CRB) integration — env-driven factory.
 *
 * Wave CRB-INTEGRATION. The composition root calls
 * `resolveCrbProvider()` once at boot; the resolved provider is then
 * available to:
 *
 *   - side-quest dispatcher (counterparty due-diligence pulls)
 *   - off-taker MSA brain tool (asks Mr. Mwikila for a CRB pull before
 *     drafting the agreement)
 *   - owner-web counterparty drawer's "Pull CRB report" CTA.
 *
 * Selection precedence:
 *   1. CRB_PROVIDER=mock | creditinfo | transunion (explicit override)
 *   2. transunion env vars present → transunion
 *   3. creditinfo env vars present → creditinfo
 *   4. fall back to mock provider so local-dev + CI always work.
 */

import type { CrbProvider } from './types.js';
import { createMockCrbProvider } from './mock-provider.js';
import { createCreditinfoCrbProvider } from './creditinfo-provider.js';
import { createTransUnionCrbProvider } from './transunion-provider.js';

export type {
  CrbProvider,
  CrbReport,
  CrbReportRequest,
  CrbCreditLine,
  CrbDefaultEntry,
  CrbHistoryEntry,
} from './types.js';

export { createMockCrbProvider } from './mock-provider.js';
export { createCreditinfoCrbProvider } from './creditinfo-provider.js';
export { createTransUnionCrbProvider } from './transunion-provider.js';

function pickByExplicit(
  env: NodeJS.ProcessEnv,
): CrbProvider | null {
  const explicit = env.CRB_PROVIDER?.trim().toLowerCase();
  switch (explicit) {
    case 'mock':
      return createMockCrbProvider();
    case 'creditinfo':
      return createCreditinfoCrbProvider(env);
    case 'transunion':
      return createTransUnionCrbProvider(env);
    default:
      return null;
  }
}

export function resolveCrbProvider(
  env: NodeJS.ProcessEnv = process.env,
): CrbProvider {
  const explicit = pickByExplicit(env);
  if (explicit) return explicit;
  if (
    env.CRB_TRANSUNION_BASE_URL?.trim() &&
    env.CRB_TRANSUNION_API_KEY?.trim() &&
    env.CRB_TRANSUNION_SUBSCRIBER_CODE?.trim()
  ) {
    return createTransUnionCrbProvider(env);
  }
  if (
    env.CRB_CREDITINFO_BASE_URL?.trim() &&
    env.CRB_CREDITINFO_API_KEY?.trim()
  ) {
    return createCreditinfoCrbProvider(env);
  }
  return createMockCrbProvider();
}

/**
 * Convenience wrapper used by the side-quest dispatcher. Resolves the
 * default provider, runs the fetch, and returns the report — keeps
 * the dispatcher free of provider-specific imports.
 */
export async function fetchCreditReport(args: {
  readonly tin: string;
  readonly nida: string;
  readonly displayName?: string;
}): Promise<import('./types.js').CrbReport> {
  const provider = resolveCrbProvider();
  return provider.fetchReport(args);
}
