/**
 * Playwright globalTeardown for the live-test suite.
 *
 * Runs after every spec — INCLUDING when spec 10-cleanup did its own
 * cascade delete. We attempt the cleanup again here defensively so a
 * spec failure mid-run (which aborts the suite before spec 10) still
 * leaves the Supabase project in a clean state.
 *
 * Cleanup errors are logged but do NOT fail the suite — the original
 * spec failure has higher signal.
 */
import { unlinkSync, readFileSync, existsSync } from 'node:fs';
import { loadLiveTestEnv, authedRequest } from './fixtures/tenant-context';
import { cleanupLiveTest } from './fixtures/cleanup';
import { TOKEN_FILE } from './global-setup';

export default async function globalTeardown(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[live-test] globalTeardown: best-effort cleanup');

  if (!existsSync(TOKEN_FILE)) {
    // eslint-disable-next-line no-console
    console.log('[live-test] globalTeardown: no token file — skip cleanup');
    return;
  }

  try {
    const env = loadLiveTestEnv();
    const { ownerToken } = JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as {
      ownerToken: string;
    };
    const authed = await authedRequest(env, ownerToken);
    try {
      const result = await cleanupLiveTest(authed);
      // eslint-disable-next-line no-console
      console.log(
        `[live-test] globalTeardown: tenantDeleted=${result.tenantDeleted} warnings=${result.warnings.length}`,
      );
      for (const warning of result.warnings) {
        // eslint-disable-next-line no-console
        console.warn(`[live-test]   warn: ${warning}`);
      }
    } finally {
      await authed.dispose();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[live-test] globalTeardown: error (non-fatal):', err);
  } finally {
    try {
      unlinkSync(TOKEN_FILE);
    } catch {
      // ignore
    }
  }
}
