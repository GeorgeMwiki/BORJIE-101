/**
 * `borjie config get / set / path / show` — inspect and mutate the
 * TOML config at `~/.config/borjie/config.toml`.
 */

import { configFilePath } from '../paths.js';
import { defaultUserConfig, loadUserConfig, saveUserConfig } from '../user-config.js';
import type { BorjieLogger } from '../logger.js';

const SETTABLE_KEYS = new Set<keyof ReturnType<typeof defaultUserConfig>>([
  'lang',
  'outputFormat',
  'color',
  'verbose',
  'profile',
  'apiUrlOverride',
  'updateCheckEnabled',
]);

export async function configShowCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  const cfg = loadUserConfig();
  opts.logger.envelope({ ok: true, data: cfg, text: formatConfig(cfg) });
}

export async function configPathCommand(opts: { readonly logger: BorjieLogger }): Promise<void> {
  opts.logger.envelope({
    ok: true,
    data: { path: configFilePath() },
    text: configFilePath(),
  });
}

export async function configGetCommand(opts: {
  readonly logger: BorjieLogger;
  readonly key: string;
}): Promise<void> {
  const cfg = loadUserConfig() as unknown as Record<string, unknown>;
  const key = normaliseKey(opts.key);
  if (!(key in cfg)) {
    opts.logger.error(`Unknown config key: ${opts.key}`);
    process.exitCode = 1;
    return;
  }
  opts.logger.envelope({ ok: true, data: { [key]: cfg[key] }, text: String(cfg[key]) });
}

export async function configSetCommand(opts: {
  readonly logger: BorjieLogger;
  readonly key: string;
  readonly value: string;
}): Promise<void> {
  const cfg = loadUserConfig();
  const key = normaliseKey(opts.key);
  if (!SETTABLE_KEYS.has(key as keyof typeof cfg)) {
    opts.logger.error(`Unknown / read-only key: ${opts.key}`);
    process.exitCode = 1;
    return;
  }
  const next = applySet(cfg, key as keyof typeof cfg, opts.value, opts.logger);
  if (!next) return;
  saveUserConfig(next);
  const nextRec = next as unknown as Record<string, unknown>;
  opts.logger.envelope({
    ok: true,
    data: { [key]: nextRec[key] },
    text: `Set ${key} = ${String(nextRec[key])}`,
  });
}

function applySet<T extends ReturnType<typeof defaultUserConfig>>(
  cfg: T,
  key: keyof T,
  raw: string,
  logger: BorjieLogger,
): T | null {
  switch (key) {
    case 'lang':
      if (raw !== 'sw' && raw !== 'en') {
        logger.error('lang must be sw or en');
        process.exitCode = 1;
        return null;
      }
      return { ...cfg, [key]: raw };
    case 'outputFormat':
      if (raw !== 'text' && raw !== 'json') {
        logger.error('outputFormat must be text or json');
        process.exitCode = 1;
        return null;
      }
      return { ...cfg, [key]: raw };
    case 'color':
    case 'verbose':
    case 'updateCheckEnabled': {
      const bool = raw === 'true' ? true : raw === 'false' ? false : null;
      if (bool === null) {
        logger.error(`${String(key)} must be true or false`);
        process.exitCode = 1;
        return null;
      }
      return { ...cfg, [key]: bool };
    }
    case 'profile':
      return { ...cfg, [key]: raw };
    case 'apiUrlOverride':
      return { ...cfg, [key]: raw.length > 0 ? raw : null };
    default:
      return { ...cfg, [key]: raw } as T;
  }
}

function normaliseKey(key: string): string {
  // Accept dotted / snake / camel forms.
  const cleaned = key.replace(/^defaults\./, '');
  switch (cleaned) {
    case 'output_format':
      return 'outputFormat';
    case 'api_url_override':
      return 'apiUrlOverride';
    case 'update_check_enabled':
      return 'updateCheckEnabled';
    default:
      return cleaned;
  }
}

function formatConfig(cfg: ReturnType<typeof loadUserConfig>): string {
  const lines: string[] = [];
  lines.push(`lang=${cfg.lang}`);
  lines.push(`outputFormat=${cfg.outputFormat}`);
  lines.push(`color=${cfg.color}`);
  lines.push(`verbose=${cfg.verbose}`);
  lines.push(`profile=${cfg.profile}`);
  lines.push(`apiUrlOverride=${cfg.apiUrlOverride ?? ''}`);
  lines.push(`updateCheckEnabled=${cfg.updateCheckEnabled}`);
  return lines.join('\n');
}
