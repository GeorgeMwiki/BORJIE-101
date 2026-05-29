/**
 * Shared session loader — every authenticated command starts by
 * fetching credentials + building an HttpClient. Bails with a clear
 * error if the user isn't signed in.
 */

import { loadCredentials } from '../credentials.js';
import { createHttpClient, type HttpClient } from '../http.js';
import type { BorjieLogger } from '../logger.js';

export interface Session {
  readonly http: HttpClient;
  readonly scopes: readonly string[];
  readonly apiBaseUrl: string;
}

export function requireSession(logger: BorjieLogger): Session {
  const creds = loadCredentials();
  if (!creds) {
    logger.error('Not signed in. Run `borjie login`.');
    process.exit(1);
  }
  const http = createHttpClient({
    apiBaseUrl: creds.apiBaseUrl,
    accessToken: creds.accessToken,
  });
  return { http, scopes: creds.scopes, apiBaseUrl: creds.apiBaseUrl };
}
