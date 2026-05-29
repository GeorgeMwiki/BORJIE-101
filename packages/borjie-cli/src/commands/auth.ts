/**
 * `borjie login` / `borjie logout` / `borjie whoami` — OAuth2 device-flow.
 */

import open from 'open';
import ora from 'ora';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_CLIENT_ID,
  DEFAULT_CLIENT_LABEL,
  DEFAULT_SCOPES,
} from '../config.js';
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  type BorjieCredentials,
} from '../credentials.js';
import { createHttpClient } from '../http.js';
import type { BorjieLogger } from '../logger.js';

interface DeviceCodeResponse {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly verification_uri_complete: string;
  readonly expires_in: number;
  readonly interval: number;
}

interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  readonly scope: string;
}

interface TokenError {
  readonly error: string;
  readonly error_description?: string;
}

const POLL_TERMINATING = new Set([
  'expired_token',
  'access_denied',
  'invalid_client',
  'invalid_grant',
  'server_error',
]);

export async function loginCommand(opts: {
  readonly logger: BorjieLogger;
  readonly apiBaseUrl?: string;
  readonly clientId?: string;
  readonly clientLabel?: string;
  readonly scopes?: readonly string[];
  readonly noBrowser?: boolean;
}): Promise<void> {
  const { logger } = opts;
  const apiBaseUrl = opts.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const clientId = opts.clientId ?? DEFAULT_CLIENT_ID;
  const clientLabel = opts.clientLabel ?? DEFAULT_CLIENT_LABEL;
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  const http = createHttpClient({ apiBaseUrl, accessToken: '', unauthenticated: true });

  const startSpinner = logger.opts.json ? null : ora('Requesting device code…').start();
  let device: DeviceCodeResponse;
  try {
    device = await http.request<DeviceCodeResponse>('/api/v1/oauth/device/code', {
      method: 'POST',
      body: { client_id: clientId, client_label: clientLabel, scopes },
    });
    startSpinner?.succeed('Device code issued.');
  } catch (err) {
    startSpinner?.fail('Failed to request device code.');
    throw err;
  }

  if (logger.opts.json) {
    logger.json({
      stage: 'device_code',
      user_code: device.user_code,
      verification_uri: device.verification_uri,
      verification_uri_complete: device.verification_uri_complete,
      expires_in: device.expires_in,
      interval: device.interval,
    });
  } else {
    logger.raw('');
    logger.raw(`  Open this URL in your browser:`);
    logger.raw(`    ${device.verification_uri}`);
    logger.raw('');
    logger.raw(`  Enter this code when prompted:`);
    logger.raw(`    ${device.user_code}`);
    logger.raw('');
    logger.raw(`  Or open the pre-filled link:`);
    logger.raw(`    ${device.verification_uri_complete}`);
    logger.raw('');
  }

  if (!opts.noBrowser) {
    try {
      await open(device.verification_uri_complete);
    } catch {
      /* best-effort browser open — the user can copy/paste */
    }
  }

  const intervalMs = Math.max(1, device.interval) * 1000;
  const deadlineMs = Date.now() + Math.max(60, device.expires_in) * 1000;
  const pollSpinner = logger.opts.json ? null : ora('Waiting for approval…').start();

  while (Date.now() < deadlineMs) {
    await sleep(intervalMs);
    try {
      const token = await http.request<TokenResponse>('/api/v1/oauth/token', {
        method: 'POST',
        body: {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: device.device_code,
          client_id: clientId,
        },
      });
      pollSpinner?.succeed('Approved.');
      const creds: BorjieCredentials = {
        version: 1,
        accessToken: token.access_token,
        tokenType: 'Bearer',
        scopes: token.scope ? token.scope.split(' ').filter(Boolean) : scopes,
        issuedAt: new Date().toISOString(),
        apiBaseUrl,
        clientId,
        clientLabel,
      };
      saveCredentials(creds);
      if (logger.opts.json) {
        logger.json({
          stage: 'authenticated',
          scopes: creds.scopes,
          apiBaseUrl: creds.apiBaseUrl,
          clientId: creds.clientId,
          credentialsFile: process.env['BORJIE_CREDENTIALS_FILE'] ?? '~/.config/borjie/credentials.json',
        });
      } else {
        logger.success(`Signed in. Scopes: ${creds.scopes.join(', ') || '(none)'}`);
        logger.info(`Credentials saved to ~/.config/borjie/credentials.json (mode 0600).`);
      }
      return;
    } catch (err) {
      const oauthErr = extractOauthError(err);
      if (oauthErr?.error === 'authorization_pending') {
        pollSpinner?.start('Waiting for approval…');
        continue;
      }
      if (oauthErr && POLL_TERMINATING.has(oauthErr.error)) {
        pollSpinner?.fail(`Login failed: ${oauthErr.error_description ?? oauthErr.error}`);
        throw new Error(oauthErr.error_description ?? oauthErr.error);
      }
      pollSpinner?.fail('Login failed.');
      throw err;
    }
  }
  pollSpinner?.fail('Login timed out.');
  throw new Error('Device code expired before approval. Run `borjie login` again.');
}

export async function logoutCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    if (opts.logger.opts.json) opts.logger.json({ stage: 'logged_out', alreadyLoggedOut: true });
    else opts.logger.info('Already signed out.');
    return;
  }
  try {
    const http = createHttpClient({
      apiBaseUrl: creds.apiBaseUrl,
      accessToken: '',
      unauthenticated: true,
    });
    await http.request('/api/v1/oauth/revoke', {
      method: 'POST',
      body: { token: creds.accessToken },
    });
  } catch {
    /* RFC 7009: server returns 200 even on bad token; ignore errors */
  }
  const removed = clearCredentials();
  if (opts.logger.opts.json) {
    opts.logger.json({ stage: 'logged_out', removed });
  } else {
    opts.logger.success(removed ? 'Signed out. Token revoked + credentials removed.' : 'Signed out.');
  }
}

export async function whoamiCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    if (opts.logger.opts.json) opts.logger.json({ authenticated: false });
    else opts.logger.error('Not signed in. Run `borjie login`.');
    process.exitCode = 1;
    return;
  }
  if (opts.logger.opts.json) {
    opts.logger.json({
      authenticated: true,
      apiBaseUrl: creds.apiBaseUrl,
      clientId: creds.clientId,
      clientLabel: creds.clientLabel,
      scopes: creds.scopes,
      issuedAt: creds.issuedAt,
    });
    return;
  }
  opts.logger.raw(`API base:     ${creds.apiBaseUrl}`);
  opts.logger.raw(`Client ID:    ${creds.clientId}`);
  if (creds.clientLabel) opts.logger.raw(`Client label: ${creds.clientLabel}`);
  opts.logger.raw(`Scopes:       ${creds.scopes.join(', ') || '(none)'}`);
  opts.logger.raw(`Issued at:    ${creds.issuedAt}`);
}

function extractOauthError(err: unknown): TokenError | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { bodyText?: string };
  if (typeof e.bodyText !== 'string' || e.bodyText.length === 0) return null;
  try {
    const json = JSON.parse(e.bodyText) as Partial<TokenError>;
    if (typeof json.error === 'string') {
      return {
        error: json.error,
        ...(typeof json.error_description === 'string'
          ? { error_description: json.error_description }
          : {}),
      };
    }
  } catch {
    /* not JSON */
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
