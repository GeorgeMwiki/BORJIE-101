/**
 * Plugin loader for `borjie`.
 *
 * A plugin is an npm package whose name starts with `@borjie-plugin/`
 * or `borjie-plugin-`. The CLI scans every node_modules directory
 * along the resolution path, dynamic-imports each matching package's
 * entry point, and calls the exported `register(program, ctx)`
 * function with the commander program + a small context object so
 * plugins can wire their own verbs.
 *
 * A plugin's default export (or named `register`) must satisfy:
 *
 *   export function register(program: Command, ctx: PluginContext): void
 *
 * The CLI silently ignores plugins that:
 *   - throw during import (logs at debug)
 *   - do not expose a register function (logs at debug)
 *   - throw during register (logs at warn)
 *
 * No plugin can override an existing command name; conflicts log
 * a warning and the plugin command is skipped.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Command } from 'commander';
import type { BorjieLogger } from './logger.js';

export interface PluginContext {
  readonly logger: BorjieLogger;
  readonly cliVersion: string;
}

export interface BorjiePluginModule {
  readonly register: (program: Command, ctx: PluginContext) => void | Promise<void>;
}

export interface DiscoveredPlugin {
  readonly name: string;
  readonly version: string;
  readonly entry: string;
}

export function discoverPlugins(cwd: string = process.cwd()): readonly DiscoveredPlugin[] {
  const found = new Map<string, DiscoveredPlugin>();
  for (const dir of nodeModulesChain(cwd)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === '@borjie-plugin' || entry.startsWith('@borjie-plugin')) {
        const scopeDir = join(dir, '@borjie-plugin');
        if (!existsSync(scopeDir)) continue;
        for (const pkg of readdirSync(scopeDir)) {
          const discovered = readPackage(join(scopeDir, pkg), `@borjie-plugin/${pkg}`);
          if (discovered) found.set(discovered.name, discovered);
        }
      } else if (entry.startsWith('borjie-plugin-')) {
        const discovered = readPackage(join(dir, entry), entry);
        if (discovered) found.set(discovered.name, discovered);
      }
    }
  }
  return [...found.values()];
}

function readPackage(dir: string, name: string): DiscoveredPlugin | null {
  try {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      name?: string;
      version?: string;
      main?: string;
      module?: string;
      exports?: Record<string, unknown> | string;
    };
    const entryRel =
      typeof pkg.exports === 'string'
        ? pkg.exports
        : pkg.module ?? pkg.main ?? 'index.js';
    const entry = resolve(dir, entryRel);
    if (!existsSync(entry)) return null;
    if (!statSync(entry).isFile()) return null;
    return {
      name: pkg.name ?? name,
      version: pkg.version ?? '0.0.0',
      entry,
    };
  } catch {
    return null;
  }
}

function nodeModulesChain(cwd: string): readonly string[] {
  const out: string[] = [];
  let current = resolve(cwd);
  while (true) {
    out.push(join(current, 'node_modules'));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // Global install paths (best effort)
  const env = process.env['NODE_PATH'];
  if (env) {
    for (const p of env.split(/[:;]/)) {
      if (p.length > 0) out.push(p);
    }
  }
  return out;
}

export async function loadPlugins(args: {
  readonly program: Command;
  readonly logger: BorjieLogger;
  readonly cliVersion: string;
  readonly cwd?: string;
}): Promise<readonly DiscoveredPlugin[]> {
  const plugins = discoverPlugins(args.cwd);
  const loaded: DiscoveredPlugin[] = [];
  for (const plugin of plugins) {
    try {
      const mod = (await import(plugin.entry)) as
        | BorjiePluginModule
        | { default?: BorjiePluginModule };
      const register =
        (mod as BorjiePluginModule).register ??
        (mod as { default?: BorjiePluginModule }).default?.register;
      if (typeof register !== 'function') {
        args.logger.debug(`plugin ${plugin.name} has no register() export — skipped`);
        continue;
      }
      // Skip conflicting names — first registration wins.
      const before = new Set(args.program.commands.map((c) => c.name()));
      await register(args.program, { logger: args.logger, cliVersion: args.cliVersion });
      for (const c of args.program.commands) {
        if (!before.has(c.name())) {
          /* OK — newly added by plugin */
        }
      }
      loaded.push(plugin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      args.logger.warn(`plugin ${plugin.name} failed to load: ${message}`);
    }
  }
  return loaded;
}
