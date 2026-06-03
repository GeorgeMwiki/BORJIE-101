/**
 * boot-smoke.ts — the LOCAL canary proxy for the api-gateway boot path.
 *
 * WHAT THIS IS
 * ------------
 * Before a real STAGING deploy we want a cheap, network-free proof that the
 * api-gateway's composition-root wiring CONSTRUCTS without throwing. This
 * script imports the four LP-30 activation seams and builds each one with
 * in-memory / degraded adapters and a minimal dummy env where every
 * `BORJIE_*` feature flag is explicitly OFF. If any factory throws, the boot
 * path is unsound and this script exits non-zero — so a broken wire is caught
 * here, not after a deploy.
 *
 *   1. Semantic-cache port      (LP-03 / lp30-kernel-ports-wiring)
 *   2. Intent-verifier port     (LP-04 / lp30-kernel-ports-wiring)
 *   3. Cognitive composer       (LP-01 / cognitive-composer-wiring +
 *                                cognitive-composition-deps-wiring)
 *   4. Channel gateway          (LP-25 / @borjie/channel-gateway)
 *   5. Privacy router           (LP-15 / privacy-router-wiring)
 *
 * It is deliberately dependency-LIGHT: no real DB, no Redis, no network. The
 * embedder is the always-rejects `createNullEmbedder()` sentinel (so the
 * semantic cache builds but stays inert), the composer inference is the
 * package's own degraded stub, and the channel gateway gets a fail-closed
 * signature verifier + anonymous tier resolver. Nothing here issues an LLM
 * call or opens a socket.
 *
 * HOW IT RESOLVES @borjie/* PACKAGES
 * ----------------------------------
 * The workspace packages are symlinked into
 * `services/api-gateway/node_modules/@borjie/*` (pnpm per-service hoist), NOT
 * into the repo-root node_modules. A bare `import '@borjie/...'` from THIS
 * file (under scripts/) would fail to resolve. So we import the gateway's
 * composition modules by ABSOLUTE path; Node then resolves each module's own
 * `@borjie/*` specifiers relative to the gateway tree where the symlinks live.
 * `createNullEmbedder` is likewise re-exported through a tiny gateway-local
 * shim path so it resolves the same way.
 *
 * RUN
 * ---
 *   ../../node_modules/.bin/tsx scripts/deploy/boot-smoke.ts
 *   # or:  npx tsx scripts/deploy/boot-smoke.ts
 *
 * Exit code 0 = PASS (every seam constructed). Non-zero = FAIL.
 *
 * @module scripts/deploy/boot-smoke
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Resolve the api-gateway composition dir as an absolute path so the imported
// modules' own @borjie/* deps resolve against the gateway's node_modules.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const GATEWAY_SRC = resolve(REPO_ROOT, 'services', 'api-gateway', 'src');
const COMPOSITION = resolve(GATEWAY_SRC, 'composition');

// ---------------------------------------------------------------------------
// Minimal dummy env — every BORJIE_* feature flag explicitly OFF. We pass this
// record EXPLICITLY into each factory (none of them read process.env when an
// `env` arg is supplied), so the smoke is hermetic and independent of the
// operator's shell.
// ---------------------------------------------------------------------------

const DUMMY_ENV: Readonly<Record<string, string | undefined>> = Object.freeze({
  NODE_ENV: 'test',
  // All canary flags OFF — this is the "lights-off" boot we deploy first.
  BORJIE_SEMANTIC_CACHE_ENABLED: '0',
  BORJIE_INTENT_VERIFIER_ENABLED: '0',
  BORJIE_INTENT_VERIFY_STRICT: '0',
  BORJIE_COGNITIVE_COMPOSER_ENABLED: '0',
  BORJIE_PRIVACY_ROUTER_ENABLED: '0',
  // No local model endpoint -> RESTRICTED data fails closed (correct default).
  BORJIE_LOCAL_MODEL_HEALTH_URL: undefined,
});

// ---------------------------------------------------------------------------
// A no-op structured logger matching the narrow `{ info?, warn? }` shape every
// wiring module accepts. Captures counts so the report can note advisory logs.
// ---------------------------------------------------------------------------

interface SmokeLogger {
  readonly info: (meta: object, msg: string) => void;
  readonly warn: (meta: object, msg: string) => void;
}

function createSmokeLogger(): SmokeLogger {
  return {
    info: () => {},
    warn: () => {},
  };
}

// The cognitive-composer wiring expects a logger with positional `(msg, meta)`
// (CognitiveLogger), distinct from the `(meta, msg)` Pino-style shape above.
interface ComposerLogger {
  readonly info: (msg: string, meta?: object) => void;
  readonly warn: (msg: string, meta?: object) => void;
}

function createComposerLogger(): ComposerLogger {
  return {
    info: () => {},
    warn: () => {},
  };
}

// ---------------------------------------------------------------------------
// Result accounting.
// ---------------------------------------------------------------------------

interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
}

/** Run one construction check, capturing any throw as a FAIL (never aborts). */
async function check(
  name: string,
  fn: () => Promise<string> | string,
): Promise<void> {
  try {
    const detail = await fn();
    record(name, true, detail);
  } catch (err) {
    const message =
      err instanceof Error ? `${err.message}` : String(err);
    record(name, false, `threw: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// The checks.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const logger = createSmokeLogger();

  // --- 0. Resolve the null embedder through the gateway's package view. -----
  // We need an EmbedderPort for the semantic cache. Importing the kernel
  // barrel by the gateway's symlink path keeps resolution consistent.
  const ciBarrel = await import(
    resolve(
      REPO_ROOT,
      'services',
      'api-gateway',
      'node_modules',
      '@borjie',
      'central-intelligence',
      'dist',
      'index.js',
    )
  ).catch(async () =>
    // Fallback to the package source barrel if dist layout differs.
    import('@borjie/central-intelligence' as string),
  );
  const createNullEmbedder = (ciBarrel as { createNullEmbedder: () => unknown })
    .createNullEmbedder;
  if (typeof createNullEmbedder !== 'function') {
    record(
      'central-intelligence:createNullEmbedder',
      false,
      'createNullEmbedder not exported from the kernel barrel',
    );
  } else {
    record(
      'central-intelligence:createNullEmbedder',
      true,
      'null embedder factory resolved',
    );
  }
  const nullEmbedder = (createNullEmbedder?.() ?? {
    modelId: 'null',
    dims: 0,
    embed: async () => [],
  }) as { readonly modelId: string };

  // --- 1. Semantic-cache port (LP-03). --------------------------------------
  await check('lp30:semantic-cache-port', async () => {
    const mod = await import(
      `${COMPOSITION}/lp30-kernel-ports-wiring.ts`
    );
    const built = mod.buildSemanticCachePort({
      embedder: nullEmbedder,
      env: DUMMY_ENV,
      logger,
    });
    if (!built?.port || typeof built.port.lookup !== 'function') {
      throw new Error('semantic-cache port missing lookup()');
    }
    if (built.enabled !== false) {
      throw new Error('semantic-cache should be DISABLED with flag off');
    }
    // Exercise a lookup — with the null embedder it must skip, never throw.
    const out = await built.port.lookup({
      userMessage: 'boot smoke probe',
      scope: { tenantId: null, surface: 'owner', personaId: 'mwikila' },
    });
    return `port built; enabled=${String(built.enabled)}; lookup.outcome=${
      (out as { outcome?: string }).outcome ?? '?'
    }`;
  });

  // --- 2. Intent-verifier port (LP-04). -------------------------------------
  await check('lp30:intent-verifier-port', async () => {
    const mod = await import(
      `${COMPOSITION}/lp30-kernel-ports-wiring.ts`
    );
    const built = mod.buildIntentVerifierPort({ env: DUMMY_ENV, logger });
    if (!built?.port || typeof built.port.verify !== 'function') {
      throw new Error('intent-verifier port missing verify()');
    }
    if (built.enabled !== false) {
      throw new Error('intent-verifier should be DISABLED with flag off');
    }
    if (built.posture !== 'advisory') {
      throw new Error(
        `intent-verifier posture should default advisory, got ${built.posture}`,
      );
    }
    // Exercise verify() — must return a permitted verdict, never throw.
    const verdict = built.port.verify({
      toolName: 'read_owner_portfolio',
      toolArgs: {},
      userMessage: 'show my portfolio',
      sessionContext: {
        recentTools: [],
        recentTopics: [],
        escalationCount: 0,
      },
    });
    return `port built; enabled=${String(built.enabled)}; posture=${
      built.posture
    }; verify.permitted=${String((verdict as { permitted?: boolean }).permitted)}`;
  });

  // --- 3. Cognitive composer (LP-01) + its 10-port deps. --------------------
  await check('cognitive:composition-deps', async () => {
    const mod = await import(
      `${COMPOSITION}/cognitive-composition-deps-wiring.ts`
    );
    const deps = mod.buildCognitiveCompositionDeps({ logger });
    if (!deps?.inference || typeof deps.inference.infer !== 'function') {
      throw new Error('composition deps missing inference port');
    }
    const portCount = Object.keys(deps).length;
    return `built ${String(portCount)} composition ports (in-memory, fail-safe)`;
  });

  await check('cognitive:composer-wiring', async () => {
    const depsMod = await import(
      `${COMPOSITION}/cognitive-composition-deps-wiring.ts`
    );
    const composerMod = await import(
      `${COMPOSITION}/cognitive-composer-wiring.ts`
    );
    const compositionDeps = depsMod.buildCognitiveCompositionDeps({ logger });
    const wired = composerMod.wireCognitiveComposer({
      compositionDeps,
      env: DUMMY_ENV,
      logger: createComposerLogger(),
    });
    if (wired === null) {
      throw new Error(
        'wireCognitiveComposer returned null (createCognitiveComposition failed)',
      );
    }
    if (typeof wired.runForTurn !== 'function') {
      throw new Error('composer missing runForTurn()');
    }
    if (wired.enabled !== false) {
      throw new Error('composer should be DISABLED with flag off');
    }
    // With the flag OFF runForTurn must short-circuit to null (no LLM cost).
    const turn = await wired.runForTurn({
      tenantId: 'smoke-tenant',
      turnId: 'smoke-turn',
      userMessage: 'boot smoke probe',
      stakes: 'low',
      surface: 'owner',
    });
    return `composer built; enabled=${String(wired.enabled)}; runForTurn(flag-off)=${
      turn === null ? 'null (fast-path)' : 'non-null'
    }`;
  });

  // --- 4. Channel gateway (LP-25). ------------------------------------------
  await check('channel-gateway', async () => {
    // Resolve the package barrel via the gateway's symlink so @borjie/* deps
    // inside it resolve correctly.
    const cg = await import(
      resolve(
        REPO_ROOT,
        'services',
        'api-gateway',
        'node_modules',
        '@borjie',
        'channel-gateway',
        'dist',
        'index.js',
      )
    ).catch(async () => import('@borjie/channel-gateway' as string));
    const createChannelGateway = (
      cg as { createChannelGateway: (deps: unknown) => unknown }
    ).createChannelGateway;
    if (typeof createChannelGateway !== 'function') {
      throw new Error('createChannelGateway not exported');
    }
    // Fail-closed signature verifier + anonymous tier resolver (degraded).
    const gateway = createChannelGateway({
      signature: { verify: () => false },
      tier: {
        resolve: async () => ({ tenantId: null, actorId: null, tier: 'employee' }),
      },
    }) as { canonicalize: (i: unknown) => Promise<{ ok: boolean }> };
    if (typeof gateway.canonicalize !== 'function') {
      throw new Error('channel gateway missing canonicalize()');
    }
    // A forged (unsigned) inbound must be REJECTED, proving the fail-closed path.
    const rejected = await gateway.canonicalize({
      channel: 'sms',
      rawBody: '{}',
      headers: {},
      payload: {},
    });
    if (rejected.ok !== false) {
      throw new Error('unsigned inbound was NOT rejected (fail-closed broken)');
    }
    // In-memory conversation store also constructs (used by state-sync).
    const store = (
      cg as { createInMemoryConversationStore?: () => unknown }
    ).createInMemoryConversationStore?.();
    return `gateway built; unsigned-rejected=true; in-memory-store=${
      store ? 'ok' : 'n/a'
    }`;
  });

  // --- 5. Privacy router (LP-15). -------------------------------------------
  await check('privacy-router', async () => {
    const mod = await import(`${COMPOSITION}/privacy-router-wiring.ts`);
    const wired = mod.buildPrivacyRouter({ env: DUMMY_ENV, logger });
    if (!wired?.router || typeof wired.router.route !== 'function') {
      throw new Error('privacy router missing route()');
    }
    if (wired.enabled !== false) {
      throw new Error('privacy router should be DISABLED with flag off');
    }
    if (typeof wired.pii?.stripPii !== 'function') {
      throw new Error('privacy router missing PII stripper');
    }
    // With routing disabled, consult must passthrough (allowed) and not throw.
    const decision = await mod.consultPrivacyRouter(
      wired,
      { text: 'boot smoke probe', knownNames: [] },
      logger,
    );
    if (decision.allowed !== true) {
      throw new Error('disabled privacy router should passthrough (allowed)');
    }
    return `router built; enabled=${String(wired.enabled)}; disabled-passthrough.allowed=${String(
      decision.allowed,
    )}`;
  });
}

// ---------------------------------------------------------------------------
// Run + report.
// ---------------------------------------------------------------------------

main()
  .then(() => {
    const failures = results.filter((r) => !r.ok);
    process.stdout.write('\n');
    process.stdout.write(
      '=== api-gateway boot-smoke (LOCAL canary proxy) ===\n',
    );
    for (const r of results) {
      const tag = r.ok ? 'PASS' : 'FAIL';
      process.stdout.write(`  [${tag}] ${r.name} — ${r.detail}\n`);
    }
    process.stdout.write('\n');
    if (failures.length === 0) {
      process.stdout.write(
        `RESULT: PASS — ${String(results.length)} construction checks; ` +
          'every seam built with degraded adapters + flags OFF. Boot path sound.\n',
      );
      process.exit(0);
    }
    process.stdout.write(
      `RESULT: FAIL — ${String(failures.length)}/${String(
        results.length,
      )} checks failed. Boot path is UNSOUND; do NOT deploy.\n`,
    );
    process.exit(1);
  })
  .catch((err: unknown) => {
    // A throw OUTSIDE the per-check guards (e.g. an import resolution failure)
    // is itself a boot-path failure — report it and exit non-zero.
    process.stderr.write('\n');
    process.stderr.write(
      '=== api-gateway boot-smoke (LOCAL canary proxy) ===\n',
    );
    process.stderr.write(
      `RESULT: FAIL — unrecoverable error before checks completed:\n  ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }\n`,
    );
    process.exit(1);
  });
