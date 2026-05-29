/**
 * Shared session loader — every authenticated command starts by
 * fetching credentials + building an HttpClient. Bails with a clear
 * error if the user isn't signed in.
 *
 * Resolution order for the active profile (highest priority first):
 *   1. process.env.BORJIE_PROFILE       — quick override
 *   2. config.toml [defaults] profile   — sticky user choice
 *   3. "default"                        — fallback
 *
 * For backwards compatibility, if no profile file exists we fall
 * through to the legacy `~/.config/borjie/credentials.json`.
 */

import { loadProfile } from '../profiles.js';
import { loadCredentials } from '../credentials.js';
import { loadUserConfig } from '../user-config.js';
import { createHttpClient, type HttpClient, type HttpTraceEvent } from '../http.js';
import type { BorjieLogger } from '../logger.js';

export interface Session {
  readonly http: HttpClient;
  readonly scopes: readonly string[];
  readonly apiBaseUrl: string;
  readonly profileName: string;
}

export function activeProfileName(): string {
  const env = process.env['BORJIE_PROFILE'];
  if (env && env.length > 0) return env;
  try {
    return loadUserConfig().profile;
  } catch {
    return 'default';
  }
}

export function requireSession(logger: BorjieLogger): Session {
  const name = activeProfileName();
  const profile = loadProfile(name);
  if (profile) {
    return buildSession(logger, {
      apiUrl: profile.apiUrl,
      accessToken: profile.accessToken,
      scopes: profile.scopes,
      profileName: profile.name,
    });
  }
  const legacy = loadCredentials();
  if (legacy) {
    return buildSession(logger, {
      apiUrl: legacy.apiBaseUrl,
      accessToken: legacy.accessToken,
      scopes: legacy.scopes,
      profileName: name,
    });
  }
  if (logger.opts.json) {
    logger.envelope({
      ok: false,
      error: {
        kind: 'auth',
        summary: 'Not signed in.',
        next: 'Run: borjie login',
      },
    });
  } else {
    logger.error('Not signed in. Run `borjie login`.');
  }
  process.exit(1);
}

export function buildSession(
  logger: BorjieLogger,
  args: {
    readonly apiUrl: string;
    readonly accessToken: string;
    readonly scopes: readonly string[];
    readonly profileName: string;
  },
): Session {
  const onTrace = logger.opts.verbose
    ? (e: HttpTraceEvent) => {
        const id = e.requestId ? ` request_id=${e.requestId}` : '';
        const latency = typeof e.latencyMs === 'number' ? ` ${e.latencyMs}ms` : '';
        const status = typeof e.status === 'number' ? ` -> ${e.status}` : '';
        logger.debug(`http ${e.direction} ${e.method} ${e.url}${status}${latency}${id}`);
      }
    : undefined;
  const http = createHttpClient({
    apiBaseUrl: args.apiUrl,
    accessToken: args.accessToken,
    ...(onTrace ? { onTrace } : {}),
  });
  return {
    http,
    scopes: args.scopes,
    apiBaseUrl: args.apiUrl,
    profileName: args.profileName,
  };
}
