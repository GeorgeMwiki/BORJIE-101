/**
 * Commander program builder. Split from cli.ts so tests can exercise
 * `program.parseAsync(['borjie', 'login', '--no-browser'])` without
 * the bin shebang side-effects.
 */

import { Command } from 'commander';
import { createLogger, type BorjieLogger, type LoggerOptions } from './logger.js';
import { loginCommand, logoutCommand, whoamiCommand } from './commands/auth.js';
import { chatCommand } from './commands/chat.js';
import {
  draftsLockCommand,
  draftsLsCommand,
  draftsNewCommand,
  draftsShowCommand,
} from './commands/drafts.js';
import { remindersAddCommand, remindersLsCommand } from './commands/reminders.js';
import { estateSitesCommand, estateWorkersCommand } from './commands/estate.js';
import { complianceCheckCommand } from './commands/compliance.js';
import { scopeCommand } from './commands/scope.js';
import { opportunitiesCommand } from './commands/opportunities.js';
import { risksCommand } from './commands/risks.js';
import { decisionsLsCommand, decisionsShowCommand } from './commands/decisions.js';
import { shareCommand } from './commands/share.js';
import { tabsLsCommand, tabsOpenCommand } from './commands/tabs.js';

export interface BuildProgramOptions {
  /** When set, every command uses this logger instead of constructing a fresh one from flags. */
  readonly logger?: BorjieLogger;
}

export function buildProgram(opts: BuildProgramOptions = {}): Command {
  const program = new Command();
  program
    .name('borjie')
    .description(
      'Borjie command-line interface — chat with Mr. Mwikila, manage drafts, reminders, estate, compliance, decisions.',
    )
    .version('0.1.0')
    .option('--json', 'machine-readable output (suppress informational logs)')
    .option('--no-color', 'disable ANSI color in stdout/stderr')
    .option('--verbose', 'verbose debug logging to stderr');

  const getLogger = (cmd: Command): BorjieLogger => {
    if (opts.logger) return opts.logger;
    const root = cmd.parent ?? cmd;
    const o = root.opts() as Partial<LoggerOptions> & { color?: boolean };
    return createLogger({
      json: Boolean(o.json),
      noColor: o.color === false,
      verbose: Boolean(o.verbose),
    });
  };

  // ── auth ────────────────────────────────────────────────────────────────
  program
    .command('login')
    .description('Sign in via OAuth2 device flow')
    .option('--api <url>', 'override the api base url')
    .option('--client-id <id>', 'override the client_id')
    .option('--client-label <label>', 'human-readable label shown on the consent screen')
    .option('--scope <s>', 'requested scope (repeatable)', collect, [])
    .option('--no-browser', 'do not auto-open the browser')
    .action(async (cmdOpts) => {
      await loginCommand({
        logger: getLogger(program),
        apiBaseUrl: cmdOpts.api,
        clientId: cmdOpts.clientId,
        clientLabel: cmdOpts.clientLabel,
        scopes: cmdOpts.scope?.length > 0 ? cmdOpts.scope : undefined,
        noBrowser: cmdOpts.browser === false,
      });
    });

  program
    .command('logout')
    .description('Revoke the current token + remove credentials')
    .action(async () => {
      await logoutCommand({ logger: getLogger(program) });
    });

  program
    .command('whoami')
    .description('Print the current identity, scopes, and api base')
    .action(async () => {
      await whoamiCommand({ logger: getLogger(program) });
    });

  // ── chat ────────────────────────────────────────────────────────────────
  program
    .command('chat')
    .description('Stream a teaching response from the brain')
    .argument('<prompt>', 'the question or instruction')
    .option('--language <code>', 'sw | en', 'sw')
    .option('--session <id>', 'continue an existing thread')
    .action(async (prompt: string, cmdOpts) => {
      await chatCommand({
        logger: getLogger(program),
        prompt,
        language: cmdOpts.language === 'en' ? 'en' : 'sw',
        ...(cmdOpts.session ? { sessionId: cmdOpts.session } : {}),
      });
    });

  // ── tabs ────────────────────────────────────────────────────────────────
  const tabs = program.command('tabs').description('Owner-cockpit tab inventory');
  tabs
    .command('ls')
    .description('List tabs')
    .action(async () => {
      await tabsLsCommand({ logger: getLogger(program) });
    });
  tabs
    .command('open')
    .description('Open a tab by id')
    .argument('<id>')
    .action(async (id: string) => {
      await tabsOpenCommand({ logger: getLogger(program), id });
    });

  // ── reminders ───────────────────────────────────────────────────────────
  const reminders = program.command('reminders').description('Reminders');
  reminders
    .command('ls')
    .description('List reminders')
    .action(async () => {
      await remindersLsCommand({ logger: getLogger(program) });
    });
  reminders
    .command('add')
    .description('Schedule a reminder')
    .argument('<text>')
    .requiredOption('--when <iso>', 'ISO-8601 datetime')
    .action(async (text: string, cmdOpts: { when: string }) => {
      await remindersAddCommand({ logger: getLogger(program), text, when: cmdOpts.when });
    });

  // ── drafts ──────────────────────────────────────────────────────────────
  const drafts = program.command('drafts').description('Document drafts');
  drafts
    .command('ls')
    .description('List drafts')
    .action(async () => {
      await draftsLsCommand({ logger: getLogger(program) });
    });
  drafts
    .command('new')
    .description('Create a draft (intent or template)')
    .option('--intent <text>', 'natural-language ask')
    .option('--template <slug>', 'template slug')
    .action(async (cmdOpts) => {
      await draftsNewCommand({
        logger: getLogger(program),
        ...(cmdOpts.intent ? { intent: cmdOpts.intent } : {}),
        ...(cmdOpts.template ? { template: cmdOpts.template } : {}),
      });
    });
  drafts
    .command('lock')
    .description('Lock a draft revision')
    .argument('<id>')
    .option('--reason <text>')
    .action(async (id: string, cmdOpts) => {
      await draftsLockCommand({
        logger: getLogger(program),
        id,
        ...(cmdOpts.reason ? { reason: cmdOpts.reason } : {}),
      });
    });
  drafts
    .command('show')
    .description('Show a draft')
    .argument('<id>')
    .action(async (id: string) => {
      await draftsShowCommand({ logger: getLogger(program), id });
    });

  // ── estate ─────────────────────────────────────────────────────────────
  const estate = program.command('estate').description('Mining estate');
  estate
    .command('sites')
    .description('List sites')
    .action(async () => {
      await estateSitesCommand({ logger: getLogger(program) });
    });
  estate
    .command('workers')
    .description('List workers')
    .action(async () => {
      await estateWorkersCommand({ logger: getLogger(program) });
    });

  // ── compliance ────────────────────────────────────────────────────────
  program
    .command('compliance')
    .description('Compliance checks')
    .argument('<verb>', 'verb (e.g. check)')
    .action(async (verb: string) => {
      if (verb !== 'check') {
        getLogger(program).error(`Unknown compliance verb: ${verb}`);
        process.exitCode = 1;
        return;
      }
      await complianceCheckCommand({ logger: getLogger(program) });
    });

  // ── scope ──────────────────────────────────────────────────────────────
  program
    .command('scope')
    .description('Scope taxonomy')
    .action(async () => {
      await scopeCommand({ logger: getLogger(program) });
    });

  // ── opportunities / risks ─────────────────────────────────────────────
  program
    .command('opportunities')
    .description('List opportunities')
    .action(async () => {
      await opportunitiesCommand({ logger: getLogger(program) });
    });
  program
    .command('risks')
    .description('List active risks')
    .action(async () => {
      await risksCommand({ logger: getLogger(program) });
    });

  // ── decisions ─────────────────────────────────────────────────────────
  const decisions = program.command('decisions').description('Decision journal');
  decisions
    .command('ls')
    .description('List decisions')
    .action(async () => {
      await decisionsLsCommand({ logger: getLogger(program) });
    });
  decisions
    .command('show')
    .description('Show a decision by id')
    .argument('<id>')
    .action(async (id: string) => {
      await decisionsShowCommand({ logger: getLogger(program), id });
    });

  // ── share ──────────────────────────────────────────────────────────────
  program
    .command('share')
    .description('Generate a share link for an entity')
    .argument('<entityType>')
    .argument('<id>')
    .action(async (entityType: string, id: string) => {
      await shareCommand({ logger: getLogger(program), entityType, id });
    });

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
