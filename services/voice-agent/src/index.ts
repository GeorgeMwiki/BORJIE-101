/**
 * @borjie/voice-agent — service entrypoint.
 *
 * Boots a Fastify HTTP server that exposes the session-minting REST surface.
 * The audio stream itself is brokered on the WebSocket channel that route
 * handlers point clients at; provider stubs do not actually open upstream
 * connections (see `src/providers/*.ts`).
 *
 * Required env vars (documented per provider; all may be unset during local
 * test runs because the providers are stubbed):
 *   OPENAI_API_KEY      — gpt-realtime-2 primary
 *   ELEVENLABS_API_KEY  — ElevenLabs v3 (Swahili / Bantu / Yo / Ig / Ha TTS)
 *   LELAPA_API_KEY      — Lelapa Vulavula (Sw / Lug / SA-Bantu STT)
 *   SPITCH_API_KEY      — Spitch (Yo / Ig / Ha STT)
 *   CARTESIA_API_KEY    — Cartesia Sonic-2 low-latency fallback TTS
 *
 * Optional runtime config:
 *   PORT                — default 8080
 *   HOST                — default 0.0.0.0
 *   VOICE_WS_BASE_URL   — absolute base for WS URLs returned to clients.
 *                         If unset the route derives from the request host.
 */

import Fastify from 'fastify';

import { authMiddleware, type TestAuthInjector } from './middleware/auth.js';
import { registerCallRoute } from './routes/call.js';
import { logger } from './logger.js';

export interface BuildAppOptions {
  readonly wsBaseUrl?: string;
  /**
   * Test-only — bypass JWT verification by stamping `request.user`
   * directly. Production constructs `buildApp({})` and so the real
   * JWT auth path always runs.
   */
  readonly testAuthInjector?: TestAuthInjector;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  });

  // Auth gate — registered BEFORE routes so the preHandler hook fires
  // on every non-public path (/health is whitelisted inside the hook).
  authMiddleware(app, {
    ...(options.testAuthInjector
      ? { testAuthInjector: options.testAuthInjector }
      : {}),
  });

  app.get('/health', async () => ({ status: 'ok' }));

  registerCallRoute(app, {
    ...(options.wsBaseUrl !== undefined ? { wsBaseUrl: options.wsBaseUrl } : {}),
  });

  return app;
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  const wsBaseUrl = process.env.VOICE_WS_BASE_URL;

  const app = await buildApp(wsBaseUrl ? { wsBaseUrl } : {});
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error({ err: error }, 'voice-agent failed to start');
    throw new Error('voice-agent failed to bind to listen address');
  }
}

// Only auto-start when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error('voice-agent fatal error', { error: error });
    process.exit(1);
  });
}
