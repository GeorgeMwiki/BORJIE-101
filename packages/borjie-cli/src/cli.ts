#!/usr/bin/env node
/**
 * `borjie` — bin entry. Wraps the commander program with:
 *
 *   1. plugin loading (third-party @borjie-plugin/* + borjie-plugin-*)
 *   2. update notifier (one-line banner if a newer version exists)
 *   3. a thin top-level catch so unexpected errors print a tidy stderr
 *      line + non-zero exit, instead of an unhandled-promise stack trace.
 */

import { buildProgram, CLI_VERSION } from './cli-program.js';
import { createLogger } from './logger.js';
import { loadUserConfig } from './user-config.js';
import { loadPlugins } from './plugins.js';
import { maybeNotifyUpdate } from './update-notifier.js';
import { printPrettyError } from './errors.js';

async function main(): Promise<void> {
  const program = buildProgram();

  // Read pre-emptive flags so plugin / update logging respects them.
  const rawArgs = process.argv.slice(2);
  const looksJson = rawArgs.includes('--json');
  const looksQuiet = rawArgs.includes('--quiet');
  const looksVerbose = rawArgs.includes('--verbose');
  const looksNoColor = rawArgs.includes('--no-color');

  const cfg = safeLoadConfig();
  const bootLogger = createLogger({
    json: looksJson || cfg.outputFormat === 'json',
    quiet: looksQuiet,
    verbose: looksVerbose || cfg.verbose,
    noColor: looksNoColor || cfg.color === false,
  });

  // Plugins
  try {
    await loadPlugins({
      program,
      logger: bootLogger,
      cliVersion: CLI_VERSION,
    });
  } catch (err) {
    // Plugin discovery should never fail the CLI — log + continue.
    bootLogger.debug(`plugin load failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Update notifier — fire-and-forget so we don't slow first-token latency.
  void maybeNotifyUpdate({
    currentVersion: CLI_VERSION,
    logger: bootLogger,
    enabled: cfg.updateCheckEnabled,
  });

  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const logger = createLogger({});
  printPrettyError(logger, err);
  process.exit(1);
});

function safeLoadConfig(): ReturnType<typeof loadUserConfig> {
  try {
    return loadUserConfig();
  } catch {
    return {
      lang: 'sw',
      outputFormat: 'text',
      color: true,
      verbose: false,
      profile: 'default',
      apiUrlOverride: null,
      updateCheckEnabled: true,
    };
  }
}
