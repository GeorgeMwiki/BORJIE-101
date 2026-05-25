/**
 * Codified ethics principles registry.
 *
 * 12 pre-shipped principles spanning Asilomar (2017), NIST AI RMF 1.0
 * (2023), IEEE P7000 series (2021), EU AI Act (Regulation 2024/1689),
 * GDPR (2016/679), Anthropic's Responsible Scaling Policy, Microsoft
 * Responsible AI Standard v2 (2022), and Google PAIR guidelines.
 *
 * Each principle is a small evaluator + metadata. Evaluators are
 * synchronous + pure; they return null when satisfied or a string
 * reason when violated. Callers compose evaluators with their own
 * input shapes — the registry is data, not framework.
 *
 * Citations are in the JSDoc per principle so an auditor can trace
 * any rule to the originating standard without leaving the source.
 */

import type {
  EthicsContext,
  EthicsPrinciple,
  Jurisdiction,
} from '../types.js';

/**
 * Helper for evaluators that check a record for a flag.
 * Falsy → "no flag set" → return reason; truthy → satisfied → null.
 */
function require(flag: unknown, reason: string): string | null {
  return flag ? null : reason;
}

// ─────────────────────────────────────────────────────────────────────
// 1. Asilomar AI Principle 6 — "Safety"
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: Asilomar AI Principles (Future of Life Institute, 2017).
 * https://futureoflife.org/open-letter/ai-principles/
 *
 * "AI systems should be safe and secure throughout their operational
 * lifetime, and verifiably so where applicable and feasible."
 */
const ASILOMAR_SAFETY: EthicsPrinciple = {
  id: 'asilomar.safety',
  name: 'Safety throughout operational lifetime',
  source: 'Asilomar AI Principles (FLI, 2017), Principle 6',
  jurisdiction: 'GLOBAL',
  severity: 'critical',
  applicableContext: ['ai-decision'],
  evaluator: (input) => {
    const i = input as { safetyTested?: boolean };
    return require(
      i?.safetyTested === true,
      'Asilomar #6 — system must be safety-tested before any deployment.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. Asilomar AI Principle 8 — "Judicial Transparency"
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: Asilomar AI Principles, Principle 8.
 * "Any involvement by an autonomous system in judicial decision-making
 * should provide a satisfactory explanation auditable by a competent
 * human authority."
 */
const ASILOMAR_JUDICIAL_TRANSPARENCY: EthicsPrinciple = {
  id: 'asilomar.judicial-transparency',
  name: 'Auditable explanation in judicial / high-stakes decisions',
  source: 'Asilomar AI Principles (FLI, 2017), Principle 8',
  jurisdiction: 'GLOBAL',
  severity: 'high',
  applicableContext: ['ai-decision', 'eviction', 'tenant-screening'],
  evaluator: (input) => {
    const i = input as { auditableExplanation?: unknown };
    return require(
      typeof i?.auditableExplanation === 'string' && i.auditableExplanation.length > 0,
      'Asilomar #8 — eviction / screening decisions must carry a human-auditable explanation.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 3. NIST AI RMF — Govern function, "Accountability"
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: NIST AI Risk Management Framework 1.0 (Jan 2023), Govern 4.1.
 * https://www.nist.gov/itl/ai-risk-management-framework
 *
 * Organisational accountability for AI risk decisions must be assigned
 * to a named role and documented.
 */
const NIST_GOVERN_ACCOUNTABILITY: EthicsPrinciple = {
  id: 'nist.rmf.govern.accountability',
  name: 'Named accountable owner per AI system',
  source: 'NIST AI RMF 1.0 (2023), Govern 4.1',
  jurisdiction: 'GLOBAL',
  severity: 'high',
  applicableContext: ['ai-decision'],
  evaluator: (input) => {
    const i = input as { accountableOwner?: string };
    return require(
      typeof i?.accountableOwner === 'string' && i.accountableOwner.length > 0,
      'NIST AI RMF Govern 4.1 — every AI system needs a named accountable owner.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 4. NIST AI RMF — Measure function, "Bias Audit"
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: NIST AI RMF 1.0, Measure 2.11 — "Fairness and bias are
 * evaluated and results are documented."
 */
const NIST_MEASURE_BIAS_AUDIT: EthicsPrinciple = {
  id: 'nist.rmf.measure.bias-audit',
  name: 'Documented fairness and bias evaluation',
  source: 'NIST AI RMF 1.0 (2023), Measure 2.11',
  jurisdiction: 'GLOBAL',
  severity: 'high',
  applicableContext: ['ai-decision', 'tenant-screening', 'pricing'],
  evaluator: (input) => {
    const i = input as { biasAuditDate?: string };
    return require(
      typeof i?.biasAuditDate === 'string' && i.biasAuditDate.length > 0,
      'NIST AI RMF Measure 2.11 — bias audit must be run and dated before deployment.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 5. IEEE P7000 — Ethical considerations during system design
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: IEEE Std 7000-2021 — "Standard Model Process for Addressing
 * Ethical Concerns During System Design".
 * https://standards.ieee.org/ieee/7000/6781/
 *
 * Requires stakeholder ethical-values elicitation be documented BEFORE
 * the system is built.
 */
const IEEE_P7000_VALUES_ELICITATION: EthicsPrinciple = {
  id: 'ieee.p7000.values-elicitation',
  name: 'Stakeholder values elicited and documented at design time',
  source: 'IEEE Std 7000-2021',
  jurisdiction: 'GLOBAL',
  severity: 'medium',
  applicableContext: ['ai-decision', 'ui-design'],
  evaluator: (input) => {
    const i = input as { stakeholderValuesDocumented?: boolean };
    return require(
      i?.stakeholderValuesDocumented === true,
      'IEEE P7000 — stakeholder ethical values must be elicited and documented at design time.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 6. EU AI Act — Article 9 (high-risk system risk management)
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: EU AI Act, Regulation (EU) 2024/1689, Article 9 — risk
 * management system, continuous iterative process across lifecycle.
 */
const EU_AI_ACT_ART_9_RISK_MGMT: EthicsPrinciple = {
  id: 'eu.ai-act.art-9.risk-mgmt',
  name: 'Risk management system across lifecycle (high-risk AI)',
  source: 'EU AI Act (Reg. 2024/1689), Article 9',
  jurisdiction: 'EU',
  severity: 'critical',
  applicableContext: ['ai-decision', 'tenant-screening', 'eviction'],
  evaluator: (input) => {
    const i = input as { riskManagementProgrammeId?: string };
    return require(
      typeof i?.riskManagementProgrammeId === 'string' && i.riskManagementProgrammeId.length > 0,
      'EU AI Act Art. 9 — high-risk AI must be tied to a documented, iterated risk management programme.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 7. EU AI Act — Article 14 (human oversight)
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: EU AI Act, Article 14 — high-risk systems must be designed
 * for effective oversight by a natural person.
 */
const EU_AI_ACT_ART_14_HUMAN_OVERSIGHT: EthicsPrinciple = {
  id: 'eu.ai-act.art-14.human-oversight',
  name: 'Effective human oversight of high-risk AI',
  source: 'EU AI Act (Reg. 2024/1689), Article 14',
  jurisdiction: 'EU',
  severity: 'critical',
  applicableContext: ['ai-decision', 'eviction', 'tenant-screening'],
  evaluator: (input) => {
    const i = input as { humanOverseerId?: string };
    return require(
      typeof i?.humanOverseerId === 'string' && i.humanOverseerId.length > 0,
      'EU AI Act Art. 14 — every high-risk decision must be reviewable by a designated human overseer.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 8. GDPR — Article 22 (no solely automated decisions)
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: GDPR (Regulation EU 2016/679), Article 22.
 * Subject has the right NOT to be subject to a decision based solely
 * on automated processing that produces legal or similarly significant
 * effects.
 */
const GDPR_ART_22_AUTOMATION_RIGHT: EthicsPrinciple = {
  id: 'gdpr.art-22.no-solely-automated',
  name: 'Right not to be subject to solely automated significant decisions',
  source: 'GDPR (Reg. EU 2016/679), Article 22',
  jurisdiction: 'EU',
  severity: 'critical',
  applicableContext: ['ai-decision', 'eviction', 'tenant-screening'],
  evaluator: (input) => {
    const i = input as {
      hasHumanReview?: boolean;
      explicitConsent?: boolean;
      contractuallyNecessary?: boolean;
    };
    // Any one of the three lawful bases suffices.
    const ok =
      i?.hasHumanReview === true ||
      i?.explicitConsent === true ||
      i?.contractuallyNecessary === true;
    return require(
      ok,
      'GDPR Art. 22 — solely-automated significant decision requires human review, explicit consent, or contractual necessity.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 9. GDPR — Article 12 (transparency to data subject)
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: GDPR Article 12 — concise, transparent, intelligible, easily
 * accessible information in plain language.
 */
const GDPR_ART_12_TRANSPARENCY: EthicsPrinciple = {
  id: 'gdpr.art-12.transparency',
  name: 'Concise, plain-language transparency to data subjects',
  source: 'GDPR (Reg. EU 2016/679), Article 12',
  jurisdiction: 'EU',
  severity: 'high',
  applicableContext: ['communication', 'consent', 'data-collection'],
  evaluator: (input) => {
    const i = input as { fleschKincaidGrade?: number };
    return require(
      typeof i?.fleschKincaidGrade === 'number' && i.fleschKincaidGrade <= 9,
      'GDPR Art. 12 — subject-facing privacy text must read at <= grade 9 (Flesch-Kincaid).',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 10. Anthropic Responsible Scaling Policy (CAI alignment)
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: Anthropic Responsible Scaling Policy (RSP) + Constitutional
 * AI training — model harm-elicitation evals must pass thresholds
 * before deployment.
 * https://www.anthropic.com/news/anthropics-responsible-scaling-policy
 */
const ANTHROPIC_RSP_HARM_EVAL: EthicsPrinciple = {
  id: 'anthropic.rsp.harm-eval',
  name: 'Harm elicitation evaluation pass before deployment',
  source: 'Anthropic Responsible Scaling Policy (2024)',
  jurisdiction: 'GLOBAL',
  severity: 'critical',
  applicableContext: ['ai-decision'],
  evaluator: (input) => {
    const i = input as { harmEvalPassed?: boolean };
    return require(
      i?.harmEvalPassed === true,
      'Anthropic RSP — model harm-elicitation eval must pass before any deployment.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 11. Microsoft Responsible AI Standard v2 — Fairness goal
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: Microsoft Responsible AI Standard v2 (June 2022), Fairness
 * Goal F1 — "minimize allocation harms across different demographic
 * groups".
 */
const MS_RAI_V2_FAIRNESS_F1: EthicsPrinciple = {
  id: 'ms.rai-v2.fairness.f1',
  name: 'Minimise allocation harms across demographic groups',
  source: 'Microsoft Responsible AI Standard v2 (2022), Fairness Goal F1',
  jurisdiction: 'GLOBAL',
  severity: 'high',
  applicableContext: ['ai-decision', 'tenant-screening', 'pricing'],
  evaluator: (input) => {
    const i = input as { fairnessReportId?: string };
    return require(
      typeof i?.fairnessReportId === 'string' && i.fairnessReportId.length > 0,
      'MS RAI v2 F1 — fairness audit report id must be attached to allocation decisions.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 12. Google PAIR — "People + AI" guidebook, Mental Models
// ─────────────────────────────────────────────────────────────────────

/**
 * Source: Google People + AI Research (PAIR) Guidebook — "Set
 * expectations" + "Build trust gradually". UI must signal when output
 * is AI-generated.
 * https://pair.withgoogle.com/guidebook/
 */
const GOOGLE_PAIR_AI_DISCLOSURE: EthicsPrinciple = {
  id: 'google.pair.ai-disclosure',
  name: 'UI signals when content/decision is AI-generated',
  source: 'Google PAIR Guidebook — Mental Models',
  jurisdiction: 'GLOBAL',
  severity: 'medium',
  applicableContext: ['ai-decision', 'ui-design', 'communication'],
  evaluator: (input) => {
    const i = input as { aiBadgeShown?: boolean };
    return require(
      i?.aiBadgeShown === true,
      'Google PAIR — AI-generated decisions/content must carry a visible "AI" badge.',
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────

export const PRE_SHIPPED_PRINCIPLES: ReadonlyArray<EthicsPrinciple> = Object.freeze([
  ASILOMAR_SAFETY,
  ASILOMAR_JUDICIAL_TRANSPARENCY,
  NIST_GOVERN_ACCOUNTABILITY,
  NIST_MEASURE_BIAS_AUDIT,
  IEEE_P7000_VALUES_ELICITATION,
  EU_AI_ACT_ART_9_RISK_MGMT,
  EU_AI_ACT_ART_14_HUMAN_OVERSIGHT,
  GDPR_ART_22_AUTOMATION_RIGHT,
  GDPR_ART_12_TRANSPARENCY,
  ANTHROPIC_RSP_HARM_EVAL,
  MS_RAI_V2_FAIRNESS_F1,
  GOOGLE_PAIR_AI_DISCLOSURE,
]);

/**
 * Filter principles applicable to a given (context, jurisdiction).
 *
 * `GLOBAL` principles always apply. `EU` principles apply for `EU` and
 * `UK` (UK GDPR is functionally identical at this level). All other
 * jurisdictions get the principles tagged for their code plus GLOBAL.
 */
export function principlesFor(
  context: EthicsContext,
  jurisdiction: Jurisdiction,
  registry: ReadonlyArray<EthicsPrinciple> = PRE_SHIPPED_PRINCIPLES,
): ReadonlyArray<EthicsPrinciple> {
  return registry.filter((p) => {
    const contextMatches = p.applicableContext.includes(context);
    if (!contextMatches) return false;
    if (p.jurisdiction === 'GLOBAL') return true;
    if (p.jurisdiction === jurisdiction) return true;
    if (p.jurisdiction === 'EU' && jurisdiction === 'UK') return true;
    return false;
  });
}

/**
 * Look up a principle by its stable id; returns undefined if unknown.
 */
export function findPrinciple(
  id: string,
  registry: ReadonlyArray<EthicsPrinciple> = PRE_SHIPPED_PRINCIPLES,
): EthicsPrinciple | undefined {
  return registry.find((p) => p.id === id);
}
