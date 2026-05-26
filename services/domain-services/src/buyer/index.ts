/**
 * Buyer domain module — Borjie mining marketplace.
 *
 * Two Postgres-backed repositories:
 *   - PostgresBuyerFinancialProfileRepository  (credit/AML/banking)
 *   - PostgresBuyerRiskReportRepository        (composite risk scoring)
 */

export * from './postgres-buyer-financial-profile-repository.js';
export * from './postgres-buyer-risk-report-repository.js';
