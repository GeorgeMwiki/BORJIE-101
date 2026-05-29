/**
 * Commander program builder. Split from cli.ts so tests can exercise
 * `program.parseAsync(['borjie', 'login', '--no-browser'])` without
 * the bin shebang side-effects.
 *
 * The program is constructed in three layers:
 *   1. Top-level program with global flags + version
 *   2. Built-in verbs (auth, chat, drafts, …) registered synchronously
 *   3. Optional dynamic layer (plugins, update-notifier) wired in by
 *      `cli.ts` *after* the bin entry so tests stay synchronous.
 */

import { Command } from 'commander';
import { createLogger, type BorjieLogger, type LoggerOptions } from './logger.js';
import { loadUserConfig } from './user-config.js';
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
import { replCommand } from './commands/repl.js';
import { diffCommand } from './commands/diff.js';
import { watchCommand } from './commands/watch.js';
import { agentRunCommand } from './commands/agent.js';
import { pluginInstallCommand, pluginLsCommand, pluginRemoveCommand } from './commands/plugin.js';
import {
  profilesLsCommand,
  profilesRmCommand,
  useProfileCommand,
} from './commands/profiles.js';
import {
  sessionsArchiveCommand,
  sessionsLsCommand,
  sessionsNewCommand,
  sessionsResumeCommand,
  sessionsShowCommand,
} from './commands/sessions.js';
import {
  configGetCommand,
  configPathCommand,
  configSetCommand,
  configShowCommand,
} from './commands/config.js';
import { completeDynamic, completionCommand } from './commands/completion.js';
import { printPrettyError } from './errors.js';

export const CLI_VERSION = '0.2.0';

export interface BuildProgramOptions {
  /** When set, every command uses this logger instead of constructing a fresh one from flags. */
  readonly logger?: BorjieLogger;
}

export function buildProgram(opts: BuildProgramOptions = {}): Command {
  const program = new Command();
  program
    .name('borjie')
    .description(
      'Borjie command-line interface — chat with Mr. Mwikila, manage drafts, reminders, estate, compliance, decisions. ' +
        'Run with no args to enter the interactive REPL.',
    )
    .version(CLI_VERSION)
    .option('--json', 'machine-readable output (suppress informational logs)')
    .option('--no-color', 'disable ANSI color in stdout/stderr')
    .option('--verbose', 'verbose debug logging to stderr (HTTP traces, error stacks)')
    .option('--quiet', 'suppress informational output, only the result')
    .option('--profile <name>', 'override the active profile for this invocation')
    .enablePositionalOptions()
    .showHelpAfterError(true);

  const getLogger = (cmd: Command): BorjieLogger => {
    if (opts.logger) return opts.logger;
    const root = cmd.parent ?? cmd;
    const o = root.opts() as Partial<LoggerOptions> & { color?: boolean; profile?: string };
    if (o.profile && typeof o.profile === 'string' && o.profile.length > 0) {
      // Surface the profile to downstream lookups via env. Synchronous
      // assignment is fine — `requireSession` reads it lazily.
      process.env['BORJIE_PROFILE'] = o.profile;
    }
    const cfg = safeLoadConfig();
    return createLogger({
      json: Boolean(o.json) || cfg.outputFormat === 'json',
      noColor: o.color === false || cfg.color === false,
      verbose: Boolean(o.verbose) || cfg.verbose === true,
      quiet: Boolean(o.quiet),
    });
  };

  const handleError = (logger: BorjieLogger, err: unknown): void => {
    printPrettyError(logger, err);
    process.exitCode = 1;
  };

  const wrap = <Args extends readonly unknown[]>(
    fn: (logger: BorjieLogger, ...args: Args) => Promise<unknown>,
  ) =>
    async (...args: Args): Promise<void> => {
      const logger = getLogger(program);
      try {
        await fn(logger, ...args);
      } catch (err) {
        handleError(logger, err);
      }
    };

  // ── default (no args) → interactive REPL ──────────────────────────
  program.action(async () => {
    const logger = getLogger(program);
    try {
      await replCommand({ logger });
    } catch (err) {
      handleError(logger, err);
    }
  });

  // ── auth ────────────────────────────────────────────────────────────────
  program
    .command('login')
    .description('Sign in via OAuth2 device flow')
    .option('--api <url>', 'override the api base url')
    .option('--client-id <id>', 'override the client_id')
    .option('--client-label <label>', 'human-readable label shown on the consent screen')
    .option('--scope <s>', 'requested scope (repeatable)', collect, [])
    .option('--no-browser', 'do not auto-open the browser')
    .option('--profile <name>', 'save credentials under a named profile (default: active profile)')
    .action(
      wrap(async (logger, cmdOpts: Record<string, unknown>) => {
        const api = cmdOpts['api'];
        const clientId = cmdOpts['clientId'];
        const clientLabel = cmdOpts['clientLabel'];
        const profile = cmdOpts['profile'];
        const scopes =
          Array.isArray(cmdOpts['scope']) && (cmdOpts['scope'] as string[]).length > 0
            ? (cmdOpts['scope'] as string[])
            : undefined;
        await loginCommand({
          logger,
          ...(typeof api === 'string' ? { apiBaseUrl: api } : {}),
          ...(typeof clientId === 'string' ? { clientId } : {}),
          ...(typeof clientLabel === 'string' ? { clientLabel } : {}),
          ...(scopes ? { scopes } : {}),
          noBrowser: cmdOpts['browser'] === false,
          ...(typeof profile === 'string' ? { profile } : {}),
        });
      }),
    );

  program
    .command('logout')
    .description('Revoke the current token + remove credentials')
    .action(wrap(async (logger) => await logoutCommand({ logger })));

  program
    .command('whoami')
    .description('Print the current identity, scopes, and api base')
    .action(wrap(async (logger) => await whoamiCommand({ logger })));

  // ── chat ────────────────────────────────────────────────────────────────
  program
    .command('chat')
    .description('Stream a teaching response from the brain (prompt may be `-` for stdin)')
    .argument('<prompt>', 'the question or instruction (or `-` to read from stdin)')
    .option('--language <code>', 'sw | en', 'sw')
    .option('--session <id>', 'continue an existing thread (or "last" for the most recent)')
    .option('--continue', 'continue the most recent session')
    .action(
      wrap(async (logger, prompt: string, cmdOpts: Record<string, unknown>) => {
        const sessionId = cmdOpts['session'] as string | undefined;
        await chatCommand({
          logger,
          prompt,
          language: cmdOpts['language'] === 'en' ? 'en' : 'sw',
          ...(sessionId ? { sessionId } : {}),
          continueSession: cmdOpts['continue'] === true,
        });
      }),
    );

  // ── tabs ────────────────────────────────────────────────────────────────
  const tabs = program.command('tabs').description('Owner-cockpit tab inventory');
  tabs
    .command('ls')
    .description('List tabs')
    .action(wrap(async (logger) => await tabsLsCommand({ logger })));
  tabs
    .command('open')
    .description('Open a tab by id')
    .argument('<id>')
    .action(wrap(async (logger, id: string) => await tabsOpenCommand({ logger, id })));

  // ── reminders ───────────────────────────────────────────────────────────
  const reminders = program.command('reminders').description('Reminders');
  reminders
    .command('ls')
    .description('List reminders')
    .action(wrap(async (logger) => await remindersLsCommand({ logger })));
  reminders
    .command('add')
    .description('Schedule a reminder')
    .argument('<text>')
    .requiredOption('--when <iso>', 'ISO-8601 datetime')
    .action(
      wrap(async (logger, text: string, cmdOpts: { when: string }) => {
        await remindersAddCommand({ logger, text, when: cmdOpts.when });
      }),
    );

  // ── drafts ──────────────────────────────────────────────────────────────
  const drafts = program.command('drafts').description('Document drafts');
  drafts
    .command('ls')
    .description('List drafts')
    .action(wrap(async (logger) => await draftsLsCommand({ logger })));
  drafts
    .command('new')
    .description('Create a draft (intent or template). `--intent -` reads from stdin.')
    .option('--intent <text>', 'natural-language ask (or `-` to read from stdin)')
    .option('--template <slug>', 'template slug')
    .action(
      wrap(async (logger, cmdOpts: Record<string, unknown>) => {
        await draftsNewCommand({
          logger,
          ...(cmdOpts['intent'] ? { intent: cmdOpts['intent'] as string } : {}),
          ...(cmdOpts['template'] ? { template: cmdOpts['template'] as string } : {}),
        });
      }),
    );
  drafts
    .command('lock')
    .description('Lock a draft revision')
    .argument('<id>')
    .option('--reason <text>')
    .action(
      wrap(async (logger, id: string, cmdOpts: Record<string, unknown>) => {
        await draftsLockCommand({
          logger,
          id,
          ...(cmdOpts['reason'] ? { reason: cmdOpts['reason'] as string } : {}),
        });
      }),
    );
  drafts
    .command('show')
    .description('Show a draft')
    .argument('<id>')
    .action(wrap(async (logger, id: string) => await draftsShowCommand({ logger, id })));

  // ── estate ─────────────────────────────────────────────────────────────
  const estate = program.command('estate').description('Mining estate');
  estate
    .command('sites')
    .description('List sites')
    .action(wrap(async (logger) => await estateSitesCommand({ logger })));
  estate
    .command('workers')
    .description('List workers')
    .action(wrap(async (logger) => await estateWorkersCommand({ logger })));

  // ── compliance ────────────────────────────────────────────────────────
  program
    .command('compliance')
    .description('Compliance checks')
    .argument('<verb>', 'verb (e.g. check)')
    .action(
      wrap(async (logger, verb: string) => {
        if (verb !== 'check') {
          logger.error(`Unknown compliance verb: ${verb}`);
          process.exitCode = 1;
          return;
        }
        await complianceCheckCommand({ logger });
      }),
    );

  // ── scope ──────────────────────────────────────────────────────────────
  program
    .command('scope')
    .description('Scope taxonomy')
    .action(wrap(async (logger) => await scopeCommand({ logger })));

  // ── opportunities / risks ─────────────────────────────────────────────
  program
    .command('opportunities')
    .description('List opportunities')
    .action(wrap(async (logger) => await opportunitiesCommand({ logger })));
  program
    .command('risks')
    .description('List active risks')
    .action(wrap(async (logger) => await risksCommand({ logger })));

  // ── decisions ─────────────────────────────────────────────────────────
  const decisions = program.command('decisions').description('Decision journal');
  decisions
    .command('ls')
    .description('List decisions')
    .action(wrap(async (logger) => await decisionsLsCommand({ logger })));
  decisions
    .command('show')
    .description('Show a decision by id')
    .argument('<id>')
    .action(wrap(async (logger, id: string) => await decisionsShowCommand({ logger, id })));

  // ── share ──────────────────────────────────────────────────────────────
  program
    .command('share')
    .description('Generate a share link for an entity')
    .argument('<entityType>')
    .argument('<id>')
    .action(
      wrap(async (logger, entityType: string, id: string) => {
        await shareCommand({ logger, entityType, id });
      }),
    );

  // ── diff ──────────────────────────────────────────────────────────────
  program
    .command('diff')
    .description('Compare estate state across time (since defaults to 24h ago, until to now)')
    .option('--since <ts>', 'ISO-8601 or relative span (e.g. 7d)', '24h')
    .option('--until <ts>', 'ISO-8601 or relative span')
    .action(
      wrap(async (logger, cmdOpts: Record<string, unknown>) => {
        await diffCommand({
          logger,
          since: (cmdOpts['since'] as string | undefined) ?? '24h',
          ...(cmdOpts['until'] ? { until: cmdOpts['until'] as string } : {}),
        });
      }),
    );

  // ── watch ──────────────────────────────────────────────────────────────
  program
    .command('watch')
    .description('Stream MCP-style notifications (opportunities, risks, reminders, …)')
    .option('--filter <list>', 'comma-separated event names to keep')
    .option('--exec <cmd>', 'shell command to invoke per event')
    .action(
      wrap(async (logger, cmdOpts: Record<string, unknown>) => {
        const filter = typeof cmdOpts['filter'] === 'string'
          ? (cmdOpts['filter'] as string)
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : undefined;
        await watchCommand({
          logger,
          ...(filter ? { filter } : {}),
          ...(cmdOpts['exec'] ? { exec: cmdOpts['exec'] as string } : {}),
        });
      }),
    );

  // ── agent ──────────────────────────────────────────────────────────────
  const agent = program.command('agent').description('Autonomous agent loop');
  agent
    .command('run')
    .description('Run an autonomous agent loop against a task description')
    .argument('<task>', 'task description (or `-` to read from stdin)')
    .option('--max-steps <n>', 'maximum steps before halting', '12')
    .option('--auto-approve', 'auto-approve every tool call (use with care)')
    .action(
      wrap(async (logger, task: string, cmdOpts: Record<string, unknown>) => {
        await agentRunCommand({
          logger,
          task,
          maxSteps: Number.parseInt(String(cmdOpts['maxSteps'] ?? 12), 10),
          autoApprove: cmdOpts['autoApprove'] === true,
        });
      }),
    );

  // ── plugin ─────────────────────────────────────────────────────────────
  const plugin = program.command('plugin').description('Manage CLI plugins');
  plugin
    .command('ls')
    .description('List installed plugins')
    .action(wrap(async (logger) => await pluginLsCommand({ logger })));
  plugin
    .command('install')
    .description('Install a plugin via npm (must match @borjie-plugin/* or borjie-plugin-*)')
    .argument('<name>')
    .action(wrap(async (logger, name: string) => await pluginInstallCommand({ logger, name })));
  plugin
    .command('remove')
    .description('Remove an installed plugin via npm')
    .argument('<name>')
    .action(wrap(async (logger, name: string) => await pluginRemoveCommand({ logger, name })));

  // ── profiles ───────────────────────────────────────────────────────────
  const profiles = program.command('profiles').description('Per-environment credential profiles');
  profiles
    .command('ls')
    .description('List profiles')
    .action(wrap(async (logger) => await profilesLsCommand({ logger })));
  profiles
    .command('rm')
    .description('Remove a profile')
    .argument('<name>')
    .action(wrap(async (logger, name: string) => await profilesRmCommand({ logger, name })));

  program
    .command('use')
    .description('Switch the active profile')
    .argument('<name>')
    .action(wrap(async (logger, name: string) => await useProfileCommand({ logger, name })));

  // ── sessions ───────────────────────────────────────────────────────────
  const sessions = program.command('sessions').description('Multi-session conversation management');
  sessions
    .command('ls')
    .description('List sessions')
    .option('--all', 'include archived sessions')
    .action(
      wrap(async (logger, cmdOpts: Record<string, unknown>) => {
        await sessionsLsCommand({ logger, all: cmdOpts['all'] === true });
      }),
    );
  sessions
    .command('show')
    .description('Show a session by id')
    .argument('<id>')
    .action(wrap(async (logger, id: string) => await sessionsShowCommand({ logger, id })));
  sessions
    .command('resume')
    .description('Resume a session (defaults to the most recent)')
    .argument('[id]')
    .action(
      wrap(async (logger, id?: string) => {
        await sessionsResumeCommand({ logger, ...(id ? { id } : {}) });
      }),
    );
  sessions
    .command('archive')
    .description('Archive a session')
    .argument('<id>')
    .action(wrap(async (logger, id: string) => await sessionsArchiveCommand({ logger, id })));
  sessions
    .command('new')
    .description('Create a new session locally')
    .option('--title <text>')
    .option('--language <code>', 'sw | en', 'sw')
    .action(
      wrap(async (logger, cmdOpts: Record<string, unknown>) => {
        await sessionsNewCommand({
          logger,
          ...(cmdOpts['title'] ? { title: cmdOpts['title'] as string } : {}),
          language: cmdOpts['language'] === 'en' ? 'en' : 'sw',
        });
      }),
    );

  // ── config ─────────────────────────────────────────────────────────────
  const config = program.command('config').description('User config (config.toml)');
  config
    .command('show')
    .description('Print the resolved config')
    .action(wrap(async (logger) => await configShowCommand({ logger })));
  config
    .command('path')
    .description('Print the config file path')
    .action(wrap(async (logger) => await configPathCommand({ logger })));
  config
    .command('get')
    .description('Get a config value')
    .argument('<key>')
    .action(wrap(async (logger, key: string) => await configGetCommand({ logger, key })));
  config
    .command('set')
    .description('Set a config value')
    .argument('<key>')
    .argument('<value>')
    .action(
      wrap(async (logger, key: string, value: string) => {
        await configSetCommand({ logger, key, value });
      }),
    );

  // ── completion ─────────────────────────────────────────────────────────
  program
    .command('completion')
    .description('Generate a shell completion script (bash | zsh | fish)')
    .argument('<shell>', 'bash | zsh | fish')
    .action(
      wrap(async (logger, shell: string) => {
        await completionCommand({ logger, program, shell });
      }),
    );

  // ── hidden: __complete (used by completion scripts) ────────────────────
  program
    .command('__complete', { hidden: true })
    .description('internal: dynamic completion hints')
    .allowExcessArguments(true)
    .argument('[args...]', 'cursor + word list')
    .action(async (args: readonly string[]) => {
      await completeDynamic(args);
    });

  return program;
}

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

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
