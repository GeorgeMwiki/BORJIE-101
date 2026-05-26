/**
 * Conditional survey module.
 *
 * The legacy `PostgresConditionalSurveyRepository` was retired during
 * the mining hard-fork (the property-domain `conditional_surveys`,
 * `conditional_survey_findings`, `conditional_survey_action_plans`
 * tables were dropped by migration 0003). The mining-domain
 * replacement lives under
 * `@borjie/domain-services/site-pre-shift-inspection` (per-asset
 * pre-shift safety checklist). The pure service + template + types
 * stay exported here for back-compat with the in-memory consumers.
 */
export * from './types.js';
export * from './conditional-survey-template.js';
export * from './conditional-survey-service.js';
