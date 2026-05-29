import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultUserConfig,
  loadUserConfig,
  saveUserConfig,
} from '../src/user-config.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'borjie-cli-cfg-'));
  process.env['BORJIE_HOME'] = dir;
  process.env['BORJIE_CONFIG_FILE'] = join(dir, 'config.toml');
});

afterEach(() => {
  delete process.env['BORJIE_HOME'];
  delete process.env['BORJIE_CONFIG_FILE'];
  rmSync(dir, { recursive: true, force: true });
});

describe('user config', () => {
  it('returns defaults when no file exists, then writes them', () => {
    const cfg = loadUserConfig();
    expect(cfg).toEqual(defaultUserConfig());
  });

  it('round-trips a saved override', () => {
    saveUserConfig({
      ...defaultUserConfig(),
      lang: 'en',
      profile: 'staging',
      outputFormat: 'json',
      color: false,
      verbose: true,
      updateCheckEnabled: false,
    });
    const cfg = loadUserConfig();
    expect(cfg.lang).toBe('en');
    expect(cfg.profile).toBe('staging');
    expect(cfg.outputFormat).toBe('json');
    expect(cfg.color).toBe(false);
    expect(cfg.verbose).toBe(true);
    expect(cfg.updateCheckEnabled).toBe(false);
  });

  it('falls back to defaults if the file is malformed', () => {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'config.toml'), 'this is = "broken" \nno equals', {
      mode: 0o600,
    });
    const cfg = loadUserConfig();
    expect(cfg).toEqual(defaultUserConfig());
  });
});
