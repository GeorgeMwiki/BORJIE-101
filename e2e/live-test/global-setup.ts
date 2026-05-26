/**
 * Playwright globalSetup for the `pnpm live-test` happy-path suite.
 *
 * Responsibilities:
 *   1. Validate the live-test environment (throws with a precise message
 *      if any required var is missing — caller can immediately fix .env).
 *   2. Sign in the bootstrap owner via Supabase Auth + sanity-check the
 *      api-gateway accepts the resulting JWT (`GET /api/me` returns 200).
 *   3. Persist the access_token to disk via the storage-state pattern so
 *      every spec inherits it without re-authenticating.
 *
 * We DO NOT seed any tenant/property data here. The whole point of the
 * live-test is that the 10 specs themselves seed and verify each step —
 * if globalSetup created the tenant, spec 02 would be moot.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadLiveTestEnv,
  signInWithPassword,
  authedRequest,
} from './fixtures/tenant-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const TOKEN_FILE = join(__dirname, '.live-test-token.json');

export default async function globalSetup(): Promise<void> {
  console.log('[live-test] globalSetup: validating env + bootstrap signin');
  const env = loadLiveTestEnv();

  // Sanity check that the api-gateway is up before we sign anyone in.
  await pingHealth(env.apiGatewayUrl);

  const ownerToken = await signInWithPassword(env, env.ownerEmail, env.ownerPassword);
  const otherToken = await signInWithPassword(env, env.otherEmail, env.otherPassword);

  // Verify the api-gateway accepts the owner token.
  const owned = await authedRequest(env, ownerToken);
  try {
    const me = await owned.request.get('/api/me', { failOnStatusCode: false });
    if (!me.ok()) {
      throw new Error(
        `globalSetup: api-gateway /api/me rejected the owner JWT (${me.status()}). ` +
          `Check SUPABASE_JWT_SECRET parity + tenant claim. See Docs/RUNBOOKS/live-test.md.`,
      );
    }
  } finally {
    await owned.dispose();
  }

  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ ownerToken, otherToken }, null, 2),
    'utf8',
  );
  console.log('[live-test] globalSetup: ok — tokens cached');
}

async function pingHealth(apiGatewayUrl: string): Promise<void> {
  // We use the global fetch (Node 20+) here rather than Playwright's request
  // context so we keep this dependency-free for the setup phase.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const resp = await fetch(`${apiGatewayUrl}/healthz`, { method: 'GET' });
      if (resp.ok) return;
    } catch {
      // swallow + retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `globalSetup: api-gateway not reachable at ${apiGatewayUrl}/healthz after 10s. ` +
      `Run \`pnpm --filter @borjie/api-gateway dev\` first.`,
  );
}
