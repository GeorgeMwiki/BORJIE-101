/**
 * Slash command loader + invoker.
 *
 * Per the 2026 Claude Agent SDK contract, custom slash commands live
 * at `.claude/commands/<name>.md`. The frontmatter declares:
 *
 *   ---
 *   description:    one-line summary, shown in picker
 *   argument-hint:  cosmetic placeholder
 *   allowed-tools:  Read, Edit          # subset enforced on invoke
 *   model:          claude-opus-4-7     # routing hint
 *   ---
 *
 *   <prompt body with $ARGUMENTS placeholder>
 *
 * On `executeCommand`, `$ARGUMENTS` is substituted with whatever the
 * user typed after the command name and the resolved prompt is sent
 * to the brain (if one was wired). When no brain is wired we still
 * return the resolved prompt so callers can route it themselves.
 *
 * Commands are cached after first load. Call `invalidate()` to bust.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  BrainPort,
  RuntimeLogger,
  SlashCommand,
  SlashCommandInvocation,
} from '../types.js';
import { noopLogger } from '../types.js';
import { asStringList, parseFrontmatter } from '../frontmatter.js';

export interface SlashCommandLoaderOptions {
  readonly projectPath: string;
  readonly userScopePath?: string;
  readonly logger?: RuntimeLogger;
}

const ARGUMENTS_TOKEN = '$ARGUMENTS';

export class SlashCommandLoader {
  readonly #projectPath: string;
  readonly #userScopePath: string | undefined;
  readonly #logger: RuntimeLogger;
  readonly #cache = new Map<string, SlashCommand>();

  constructor(opts: SlashCommandLoaderOptions) {
    this.#projectPath = opts.projectPath;
    this.#userScopePath = opts.userScopePath;
    this.#logger = opts.logger ?? noopLogger;
  }

  /** Forces a re-read on next `loadCommand`. */
  invalidate(): void {
    this.#cache.clear();
  }

  async loadCommand(name: string): Promise<SlashCommand | undefined> {
    const cached = this.#cache.get(name);
    if (cached !== undefined) return cached;
    const path = await this.#resolveCommandPath(name);
    if (path === undefined) return undefined;
    const raw = await readFile(path, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const command: SlashCommand = {
      name,
      ...(typeof data['description'] === 'string'
        ? { description: data['description'] as string }
        : {}),
      ...(typeof data['argument-hint'] === 'string'
        ? { argumentHint: data['argument-hint'] as string }
        : {}),
      ...((): { allowedTools?: ReadonlyArray<string> } => {
        const list = asStringList(data['allowed-tools']);
        return list !== undefined ? { allowedTools: list } : {};
      })(),
      ...(typeof data['model'] === 'string' ? { model: data['model'] as string } : {}),
      prompt: body,
      source: path,
    };
    this.#cache.set(name, command);
    return command;
  }

  /** Enumerates every command discoverable in project + user scope. */
  async listCommands(): Promise<ReadonlyArray<string>> {
    const names = new Set<string>();
    const dirs = [
      join(this.#projectPath, '.claude', 'commands'),
      ...(this.#userScopePath !== undefined ? [join(this.#userScopePath, 'commands')] : []),
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const files = await readdir(dir);
        for (const f of files) {
          if (f.endsWith('.md')) names.add(f.replace(/\.md$/, ''));
        }
      } catch (err) {
        this.#logger.log('warn', `agent-runtime: cannot list ${dir}`, {
          error: (err as Error).message,
        });
      }
    }
    return Object.freeze([...names].sort());
  }

  /**
   * Substitutes `$ARGUMENTS` and, when a brain is supplied, sends the
   * resolved prompt to it. Either way the resolved prompt is returned
   * so the caller can route it themselves if no brain was wired.
   */
  async executeCommand(args: {
    readonly name: string;
    readonly args: string;
    readonly brain?: BrainPort;
  }): Promise<SlashCommandInvocation & { readonly response?: unknown }> {
    const command = await this.loadCommand(args.name);
    if (command === undefined) {
      throw new Error(`slash command not found: /${args.name}`);
    }
    const resolvedPrompt = substituteArguments(command.prompt, args.args);
    const invocation: SlashCommandInvocation = {
      name: args.name,
      args: args.args,
      resolvedPrompt,
      ...(command.allowedTools !== undefined ? { allowedTools: command.allowedTools } : {}),
      ...(command.model !== undefined ? { model: command.model } : {}),
    };
    if (args.brain === undefined) {
      return invocation;
    }
    const response = await args.brain.call({
      prompt: resolvedPrompt,
      ...(command.allowedTools !== undefined ? { allowedTools: command.allowedTools } : {}),
      ...(command.model !== undefined ? { model: command.model } : {}),
    });
    return { ...invocation, response };
  }

  async #resolveCommandPath(name: string): Promise<string | undefined> {
    const candidates = [
      join(this.#projectPath, '.claude', 'commands', `${name}.md`),
      ...(this.#userScopePath !== undefined
        ? [join(this.#userScopePath, 'commands', `${name}.md`)]
        : []),
    ];
    for (const path of candidates) {
      try {
        const s = await stat(path);
        if (s.isFile()) return path;
      } catch {
        // not present — try next
      }
    }
    return undefined;
  }
}

export function substituteArguments(template: string, args: string): string {
  // Use `split + join` so the substitution is global without regex
  // escaping pitfalls when `args` contains `$&` etc.
  return template.split(ARGUMENTS_TOKEN).join(args);
}
