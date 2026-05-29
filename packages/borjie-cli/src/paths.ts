/**
 * Filesystem path helpers for `borjie` CLI.
 *
 * Centralises the layout of `~/.config/borjie/` so every module reads
 * from the same canonical location. Tests can override every path via
 * the env vars below.
 *
 *   ~/.config/borjie/
 *     ├── credentials.json           legacy single-profile credentials
 *     ├── config.toml                user defaults (lang, output, profile)
 *     ├── update-check.json          24h cache for npm-version notifier
 *     ├── history                    REPL history (one prompt per line)
 *     ├── profiles/
 *     │   ├── default.json           { accessToken, apiUrl, clientLabel }
 *     │   └── demo.json
 *     ├── sessions/
 *     │   └── <id>.json              per brain-session metadata
 *     └── agent-runs/
 *         └── <id>.jsonl             one JSON object per step
 *
 * Override env vars (mainly for tests):
 *   BORJIE_HOME — root dir (default: ~/.config/borjie)
 *   BORJIE_CREDENTIALS_FILE — full path to legacy credentials.json
 *   BORJIE_CONFIG_FILE — full path to config.toml
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR_MODE = 0o700;

export function borjieHome(): string {
  const override = process.env['BORJIE_HOME'];
  if (override && override.length > 0) return override;
  return join(homedir(), '.config', 'borjie');
}

export function ensureBorjieDir(sub?: string): string {
  const root = borjieHome();
  const path = sub ? join(root, sub) : root;
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: DIR_MODE });
  return path;
}

export function configFilePath(): string {
  const override = process.env['BORJIE_CONFIG_FILE'];
  if (override && override.length > 0) return override;
  return join(borjieHome(), 'config.toml');
}

export function updateCheckFilePath(): string {
  return join(borjieHome(), 'update-check.json');
}

export function historyFilePath(): string {
  return join(borjieHome(), 'history');
}

export function profilesDir(): string {
  return join(borjieHome(), 'profiles');
}

export function profileFilePath(name: string): string {
  return join(profilesDir(), `${sanitiseName(name)}.json`);
}

export function sessionsDir(): string {
  return join(borjieHome(), 'sessions');
}

export function sessionFilePath(id: string): string {
  return join(sessionsDir(), `${sanitiseName(id)}.json`);
}

export function agentRunsDir(): string {
  return join(borjieHome(), 'agent-runs');
}

export function agentRunFilePath(id: string): string {
  return join(agentRunsDir(), `${sanitiseName(id)}.jsonl`);
}

function sanitiseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
