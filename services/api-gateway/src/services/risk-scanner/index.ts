/**
 * Risk Scanner — public barrel.
 *
 * Mirrors the opportunity-scanner public surface, polarity-flipped. The
 * brain tools (`mining.risks.scan` / `expand` / `mitigate` / `acknowledge`)
 * import from here; the daily-brief composer and the SSE block parser
 * also wire through this module.
 */

export {
  scanRisks,
  evaluateRisks,
  buildScannerState,
  listRules,
  countRulesByKind,
  type RiskScannerDeps,
} from './scanner';
export { RISK_RULES } from './scan-rules';
export {
  SEVERITY_WEIGHT,
  scoreRisk,
  type Risk,
  type RiskKind,
  type RiskMitigationAction,
  type RiskRule,
  type RiskScannerState,
  type RiskSeverity,
  type ScanRisksOptions,
  type BilingualText,
} from './types';
