/**
 * @borjie/marketing-brain — public-facing marketing chat brain.
 *
 * Mr. Mwikila's marketing dimension. Powers the unauthenticated
 * conversation on borjie.com landing page.
 */

// marketing-persona.ts removed (dead property-domain layer). Live marketing prompt is
// BORJIE_MARKETING_SYSTEM_PROMPT_EN in services/api-gateway/src/routes/public-chat.hono.ts.
export * from './marketing-few-shots.js';
export * from './lead-qualifier.js';
export * from './demo-data-generator.js';
export * from './pricing-advisor.js';
export * from './waitlist-integrator.js';
export * as BlogEngine from './blog-engine/index.js';
export * as Sandbox from './sandbox/index.js';
export * as LeadCapture from './lead-capture/index.js';
