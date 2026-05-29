/**
 * User config file at `~/.config/borjie/config.toml`.
 *
 * Loaded once at CLI startup; CLI flags override config values. The
 * file is auto-created on first run with sensible defaults. We never
 * read `process.env` outside this module to keep configuration
 * sourcing explicit and testable.
 *
 * Layout:
 *   [defaults]
 *   lang = "sw" | "en"
 *   output_format = "text" | "json"
 *   color = true | false
 *   verbose = false
 *   profile = "default"
 *   api_url_override = ""        # empty = use profile / env
 *
 *   [update_check]
 *   enabled = true
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { configFilePath, ensureBorjieDir } from './paths.js';
import { parseToml, stringifyToml, type TomlDoc } from './toml.js';

export interface UserConfig {
  readonly lang: 'sw' | 'en';
  readonly outputFormat: 'text' | 'json';
  readonly color: boolean;
  readonly verbose: boolean;
  readonly profile: string;
  readonly apiUrlOverride: string | null;
  readonly updateCheckEnabled: boolean;
}

const DEFAULTS: UserConfig = Object.freeze({
  lang: 'sw',
  outputFormat: 'text',
  color: true,
  verbose: false,
  profile: 'default',
  apiUrlOverride: null,
  updateCheckEnabled: true,
});

export function defaultUserConfig(): UserConfig {
  return DEFAULTS;
}

export function loadUserConfig(): UserConfig {
  const path = configFilePath();
  if (!existsSync(path)) {
    saveUserConfig(DEFAULTS);
    return DEFAULTS;
  }
  let doc: TomlDoc;
  try {
    doc = parseToml(readFileSync(path, 'utf8'));
  } catch {
    return DEFAULTS;
  }
  const defaults = doc['defaults'] ?? {};
  const updateCheck = doc['update_check'] ?? {};
  const lang = readString(defaults['lang'], DEFAULTS.lang);
  const output = readString(defaults['output_format'], DEFAULTS.outputFormat);
  const apiUrl = readString(defaults['api_url_override'], '');
  return Object.freeze({
    lang: lang === 'en' ? 'en' : 'sw',
    outputFormat: output === 'json' ? 'json' : 'text',
    color: readBool(defaults['color'], DEFAULTS.color),
    verbose: readBool(defaults['verbose'], DEFAULTS.verbose),
    profile: readString(defaults['profile'], DEFAULTS.profile),
    apiUrlOverride: apiUrl.length > 0 ? apiUrl : null,
    updateCheckEnabled: readBool(updateCheck['enabled'], DEFAULTS.updateCheckEnabled),
  });
}

export function saveUserConfig(cfg: UserConfig): void {
  ensureBorjieDir();
  const doc: TomlDoc = {
    _: {},
    defaults: {
      lang: cfg.lang,
      output_format: cfg.outputFormat,
      color: cfg.color,
      verbose: cfg.verbose,
      profile: cfg.profile,
      api_url_override: cfg.apiUrlOverride ?? '',
    },
    update_check: {
      enabled: cfg.updateCheckEnabled,
    },
  };
  writeFileSync(configFilePath(), stringifyToml(doc), { mode: 0o600 });
}

function readString(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function readBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
