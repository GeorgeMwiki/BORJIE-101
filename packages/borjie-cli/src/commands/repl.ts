/**
 * `borjie` (no args) — interactive REPL.
 *
 * Each line entered is streamed to /api/v1/brain/teach. Built-in
 * commands start with `/`:
 *
 *   /help     show the help text
 *   /exit     leave the REPL (also Ctrl+D / Ctrl+C)
 *   /clear    clear the screen
 *   /login    invoke the standard login command
 *   /whoami   print the current identity
 *   /tabs     list owner tabs
 *   /lang sw|en  switch language for subsequent prompts
 *   /json     toggle JSON output mode
 *   /scope    print scopes attached to the current token
 *
 * History is appended to `~/.config/borjie/history` (one line per
 * non-`/` prompt) and replayed via readline's stack so the up-arrow
 * recalls previous prompts.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import kleur from 'kleur';
import { ensureBorjieDir, historyFilePath } from '../paths.js';
import { activeProfileName } from './_session.js';
import { loadProfile } from '../profiles.js';
import { chatCommand } from './chat.js';
import { whoamiCommand, loginCommand } from './auth.js';
import { tabsLsCommand } from './tabs.js';
import { scopeCommand } from './scope.js';
import type { BorjieLogger } from '../logger.js';
import { createLogger } from '../logger.js';

const BANNER = `
${kleur.cyan('Borjie REPL')} — type a question, ${kleur.dim('/help')} for commands, ${kleur.dim('/exit')} to leave.`;

export async function replCommand(opts: {
  readonly logger: BorjieLogger;
  readonly initialLanguage?: 'sw' | 'en';
}): Promise<void> {
  ensureBorjieDir();
  let logger = opts.logger;
  let language: 'sw' | 'en' = opts.initialLanguage ?? 'sw';

  const history = loadHistory();
  const rl = readline.createInterface({
    input,
    output,
    history: [...history],
    terminal: process.stdout.isTTY,
  });

  printBanner(logger);
  rl.on('SIGINT', () => {
    rl.close();
  });

  while (true) {
    const profile = activeProfileName();
    const loaded = loadProfile(profile);
    const prefix = loaded ? loaded.name : '(no profile)';
    const prompt = logger.opts.noColor
      ? `[${prefix} ${language}]> `
      : `${kleur.cyan(`[${prefix} ${language}]`)}${kleur.dim('> ')}`;
    let line: string;
    try {
      line = await rl.question(prompt);
    } catch {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('/')) {
      const stop = await handleSlashCommand(trimmed, {
        logger,
        setLogger: (l) => {
          logger = l;
        },
        setLanguage: (lng) => {
          language = lng;
        },
      });
      if (stop) break;
      continue;
    }

    appendHistory(trimmed);
    try {
      await chatCommand({ logger, prompt: trimmed, language });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(message);
    }
  }
  rl.close();
}

interface SlashHandlers {
  readonly logger: BorjieLogger;
  setLogger(l: BorjieLogger): void;
  setLanguage(l: 'sw' | 'en'): void;
}

async function handleSlashCommand(input: string, h: SlashHandlers): Promise<boolean> {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';
  switch (cmd) {
    case 'exit':
    case 'quit':
    case 'q':
      return true;
    case 'help':
      printHelp(h.logger);
      return false;
    case 'clear':
      process.stdout.write('\x1b[2J\x1b[0;0H');
      return false;
    case 'login':
      try {
        await loginCommand({ logger: h.logger });
      } catch (err) {
        h.logger.error(err instanceof Error ? err.message : String(err));
      }
      return false;
    case 'whoami':
      try {
        await whoamiCommand({ logger: h.logger });
      } catch (err) {
        h.logger.error(err instanceof Error ? err.message : String(err));
      }
      return false;
    case 'tabs':
      try {
        await tabsLsCommand({ logger: h.logger });
      } catch (err) {
        h.logger.error(err instanceof Error ? err.message : String(err));
      }
      return false;
    case 'scope':
      try {
        await scopeCommand({ logger: h.logger });
      } catch (err) {
        h.logger.error(err instanceof Error ? err.message : String(err));
      }
      return false;
    case 'lang': {
      const lng = parts[1]?.toLowerCase();
      if (lng === 'sw' || lng === 'en') {
        h.setLanguage(lng);
        h.logger.info(`Language switched to ${lng}.`);
      } else {
        h.logger.warn('Usage: /lang sw|en');
      }
      return false;
    }
    case 'json': {
      const next = !h.logger.opts.json;
      h.setLogger(
        createLogger({
          json: next,
          noColor: h.logger.opts.noColor,
          verbose: h.logger.opts.verbose,
          quiet: h.logger.opts.quiet,
        }),
      );
      h.logger.info(`JSON mode ${next ? 'on' : 'off'}.`);
      return false;
    }
    default:
      h.logger.warn(`Unknown slash command: /${cmd}. Try /help.`);
      return false;
  }
}

function printBanner(logger: BorjieLogger): void {
  if (logger.opts.json) return;
  logger.info(BANNER.trim());
}

function printHelp(logger: BorjieLogger): void {
  if (logger.opts.json) {
    logger.json({
      commands: ['/help', '/exit', '/clear', '/login', '/whoami', '/tabs', '/scope', '/lang sw|en', '/json'],
    });
    return;
  }
  logger.raw('Commands:');
  logger.raw('  /help            this message');
  logger.raw('  /exit            leave the REPL');
  logger.raw('  /clear           clear screen');
  logger.raw('  /login           OAuth2 device-flow login');
  logger.raw('  /whoami          show identity + scopes');
  logger.raw('  /tabs            list owner tabs');
  logger.raw('  /scope           show selected scope nodes');
  logger.raw('  /lang sw|en      switch language');
  logger.raw('  /json            toggle JSON output mode');
  logger.raw('Anything else is sent to Mr. Mwikila as a chat prompt.');
}

function loadHistory(): readonly string[] {
  try {
    const path = historyFilePath();
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .reverse()
      .slice(0, 1000);
  } catch {
    return [];
  }
}

function appendHistory(line: string): void {
  try {
    appendFileSync(historyFilePath(), line + '\n', { mode: 0o600 });
  } catch {
    /* best effort */
  }
}
