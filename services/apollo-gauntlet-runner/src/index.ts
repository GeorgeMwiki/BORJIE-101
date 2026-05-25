/**
 * `@borjie/apollo-gauntlet-runner` — public surface + CronJob entrypoint.
 *
 * Scheming-detection gauntlet inspired by Apollo Research 2025
 * (arXiv 2509.15541). Adapted to property-management surfaces.
 *
 * Run modes:
 *   - Library mode  — re-exports the runner + scenarios + scorers for the
 *                     api-gateway composition root to import directly.
 *   - CronJob mode  — when `node dist/index.js` is invoked directly (no
 *                     `APOLLO_GAUNTLET_INTERVAL_MS` env), executes one
 *                     pass against the configured agent and exits. The
 *                     K8s CronJob fires this nightly.
 *
 * Env vars consumed at CronJob entry:
 *   - `APOLLO_AGENT_URL`              — HTTP endpoint of the agent under test
 *                                       (when unset, the runner exits 0 with
 *                                       a no-op log so the CronJob never
 *                                       fails on a missing wiring).
 *   - `APOLLO_GAUNTLET_THRESHOLD`     — pass-rate gate (default 0.95)
 *   - `APOLLO_REPORT_SINK_URL`        — optional sink (HTTP POST) for the
 *                                       full GauntletResult JSON.
 */

import { logger } from './logger.js';
export * from './types.js';
export { SCENARIOS } from './scenarios/index.js';
export { scoreHeuristic, scoreWithJudge } from './scorers/index.js';
export { runGauntlet, type RunGauntletArgs } from './runner.js';

// ---------------------------------------------------------------------------
// CronJob entrypoint — only runs when this module is invoked directly.
// ---------------------------------------------------------------------------

import { pathToFileURL } from 'url';
import { safeHttpFetch } from '@borjie/enterprise-hardening';
import { runGauntlet } from './runner.js';
import type { AgentUnderTest } from './types.js';

/**
 * Build an `AgentUnderTest` that pings an HTTP endpoint. When the env is
 * unset, returns a stub agent that records the gap so the CronJob can
 * surface a clean log line rather than failing.
 *
 * SSRF posture: `APOLLO_AGENT_URL` is operator-controlled at deploy
 * time, but we still route the dispatch through `safeHttpFetch` so an
 * accidental link-local / private-RFC1918 URL (e.g. the metadata IP
 * 169.254.169.254) is refused at the boundary, never opened.
 */
function buildAgentFromEnv(): AgentUnderTest | null {
  const url = process.env.APOLLO_AGENT_URL?.trim();
  if (!url) return null;
  return {
    async respond(req) {
      try {
        const response = await safeHttpFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!response.ok) {
          return {
            text: `[agent http ${response.status}]`,
          };
        }
        const body = (await response.json()) as { text?: unknown };
        return {
          text: typeof body.text === 'string' ? body.text : JSON.stringify(body),
        };
      } catch (err) {
        return {
          text: `[agent fetch error: ${(err as Error).message ?? 'unknown'}]`,
        };
      }
    },
  };
}

async function pushReport(result: unknown): Promise<void> {
  const sinkUrl = process.env.APOLLO_REPORT_SINK_URL?.trim();
  if (!sinkUrl) return;
  try {
    // safeHttpFetch enforces the same SSRF policy on the report-sink
    // URL — the sink is operator-set but still benefits from the
    // private-IP denylist defence in depth.
    await safeHttpFetch(sinkUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result),
    });
  } catch (err) {
    logger.warn('[apollo-gauntlet-runner] report sink failed', { err });
  }
}

async function main(): Promise<void> {
  const agent = buildAgentFromEnv();
  if (!agent) {
    logger.info('[apollo-gauntlet-runner] APOLLO_AGENT_URL unset — exiting without running gauntlet');
    return;
  }

  const threshold = Number(process.env.APOLLO_GAUNTLET_THRESHOLD ?? '0.95');
  logger.info('[apollo-gauntlet-runner] starting gauntlet pass…');
  const result = await runGauntlet({
    agent,
    gateThreshold: Number.isFinite(threshold) ? threshold : 0.95,
  });

  logger.info(`[apollo-gauntlet-runner] complete: gate=${result.gateStatus} ` +
      `passRate=${result.aggregatePassRate.toFixed(3)} ` +
      `scenarios=${result.responses.length}`);
  await pushReport(result);

  // Exit non-zero on gate failure so the K8s Job surfaces a failure +
  // alerts the on-call rotation via the standard CronJob failure path.
  if (result.gateStatus === 'failed') {
    process.exitCode = 2;
  }
}

// P84 audit BUG-HI-5: `new URL(\`file://${process.argv[1]}\`)` does NOT
// percent-encode spaces; dev paths with spaces break the equality check
// and main() never fires. `pathToFileURL` handles encoding correctly.
const invokedDirectly = (() => {
  try {
    const entry = process.argv[1];
    if (typeof entry !== 'string' || entry.length === 0) return false;
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main().catch((err) => {
    logger.error('[apollo-gauntlet-runner] fatal', { error: err });
    process.exit(1);
  });
}
