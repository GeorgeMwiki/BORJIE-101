import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { discoverPlugins, loadPlugins } from '../src/plugins.js';
import { createLogger } from '../src/logger.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'borjie-cli-plugins-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function makeScopedPlugin(name: string, body: string): void {
  const dir = join(cwd, 'node_modules', '@borjie-plugin', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `@borjie-plugin/${name}`, version: '0.1.0', main: 'index.js' }),
  );
  writeFileSync(join(dir, 'index.js'), body);
}

function makeUnscopedPlugin(name: string, body: string): void {
  const dir = join(cwd, 'node_modules', `borjie-plugin-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: `borjie-plugin-${name}`, version: '0.2.0', main: 'index.js' }),
  );
  writeFileSync(join(dir, 'index.js'), body);
}

describe('plugin discovery + loading', () => {
  it('discovers both naming conventions', () => {
    makeScopedPlugin('hello', `module.exports = { register(p) { p.command('hello').action(()=>{}) } };`);
    makeUnscopedPlugin('world', `module.exports = { register(p) { p.command('world').action(()=>{}) } };`);
    const list = discoverPlugins(cwd);
    const names = list.map((p) => p.name).sort();
    expect(names).toContain('@borjie-plugin/hello');
    expect(names).toContain('borjie-plugin-world');
  });

  it('registers commands via loadPlugins', async () => {
    makeScopedPlugin('hi', `module.exports = { register(p) { p.command('hi').action(()=>{}) } };`);
    const program = new Command();
    program.name('borjie');
    const logger = createLogger({ json: false });
    const loaded = await loadPlugins({
      program,
      logger,
      cliVersion: '0.0.0',
      cwd,
    });
    expect(loaded.length).toBe(1);
    expect(program.commands.map((c) => c.name())).toContain('hi');
  });

  it('skips plugins with no register() export', async () => {
    makeScopedPlugin('nada', `module.exports = {};`);
    const program = new Command();
    program.name('borjie');
    const logger = createLogger({ json: false });
    const loaded = await loadPlugins({
      program,
      logger,
      cliVersion: '0.0.0',
      cwd,
    });
    expect(loaded.length).toBe(0);
  });
});
