/**
 * Parser smoke tests for the `borjie` CLI.
 *
 * We exercise commander's parseAsync to assert the program registers
 * every verb the README documents. We avoid hitting the network by
 * passing `--help` first (no action) and by injecting a no-op logger.
 */

import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli-program.js';
import { createLogger } from '../src/logger.js';

const silentLogger = createLogger({ json: true, noColor: true, verbose: false });

function programNames(): readonly string[] {
  const program = buildProgram({ logger: silentLogger });
  return program.commands.map((c) => c.name());
}

describe('borjie CLI program', () => {
  it('registers all top-level verbs', () => {
    const names = programNames();
    for (const required of [
      'login',
      'logout',
      'whoami',
      'chat',
      'tabs',
      'reminders',
      'drafts',
      'estate',
      'compliance',
      'scope',
      'opportunities',
      'risks',
      'decisions',
      'share',
    ]) {
      expect(names, `missing verb: ${required}`).toContain(required);
    }
  });

  it('exposes drafts sub-commands', () => {
    const program = buildProgram({ logger: silentLogger });
    const drafts = program.commands.find((c) => c.name() === 'drafts');
    expect(drafts).toBeDefined();
    const subs = (drafts?.commands ?? []).map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['ls', 'new', 'lock', 'show']));
  });

  it('exposes reminders sub-commands', () => {
    const program = buildProgram({ logger: silentLogger });
    const r = program.commands.find((c) => c.name() === 'reminders');
    const subs = (r?.commands ?? []).map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['ls', 'add']));
  });

  it('exposes decisions sub-commands', () => {
    const program = buildProgram({ logger: silentLogger });
    const d = program.commands.find((c) => c.name() === 'decisions');
    const subs = (d?.commands ?? []).map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['ls', 'show']));
  });

  it('exposes tabs sub-commands', () => {
    const program = buildProgram({ logger: silentLogger });
    const t = program.commands.find((c) => c.name() === 'tabs');
    const subs = (t?.commands ?? []).map((c) => c.name());
    expect(subs).toEqual(expect.arrayContaining(['ls', 'open']));
  });

  it('exposes global --json / --no-color / --verbose flags', () => {
    const program = buildProgram({ logger: silentLogger });
    const opts = program.options.map((o) => o.long);
    expect(opts).toEqual(
      expect.arrayContaining(['--json', '--no-color', '--verbose']),
    );
  });
});
