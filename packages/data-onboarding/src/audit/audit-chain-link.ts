/**
 * Audit-chain link.
 *
 * Thin wrapper around `@borjie/audit-hash-chain` for the
 * data-onboarding domain. Every persisted row, every schema-evolution
 * proposal, and every enrichment finding gets sealed with one of the
 * three named secrets so post-hoc verification is possible.
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';

export type DataOnboardingAuditScope =
  | 'session'
  | 'schema_proposal'
  | 'row_persist'
  | 'enrichment'
  | 'tab_proposal';

const SECRET_BY_SCOPE: Readonly<Record<DataOnboardingAuditScope, string>> =
  Object.freeze({
    session: 'data_onboarding_session_v1',
    schema_proposal: 'data_onboarding_schema_v1',
    row_persist: 'data_onboarding_v1',
    enrichment: 'data_onboarding_enrichment_v1',
    tab_proposal: 'data_onboarding_tab_v1',
  });

export function sealAuditEvent(args: {
  readonly scope: DataOnboardingAuditScope;
  readonly payload: Readonly<Record<string, unknown>>;
}): string {
  return hashChainEntry({
    payload: args.payload,
    secretId: SECRET_BY_SCOPE[args.scope],
  });
}

export const __TEST_ONLY = Object.freeze({ SECRET_BY_SCOPE });
