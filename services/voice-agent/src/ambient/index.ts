/**
 * Ambient sub-module barrel.
 *
 * Provides the wire factory + route registrars that the voice-agent
 * entrypoint can bolt onto its Fastify app. The barrel intentionally
 * does NOT auto-register — the parent service is in charge of routing
 * order (auth middleware must run before any ambient route).
 *
 * Wave 19J. Spec: Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md.
 * Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
 * — Decisions 3 + 4.
 */

export {
  createAmbientWiring,
  type AmbientWiring,
  type AmbientWiringOptions,
} from './pipeline-wire.js';

export {
  registerConsentRoutes,
  type ConsentRoutesDeps,
} from './consent-routes.js';

export {
  registerKillSwitchRoutes,
  type KillSwitchRoutesDeps,
} from './kill-switch-routes.js';
