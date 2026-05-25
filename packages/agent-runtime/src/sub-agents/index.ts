/**
 * Sub-agent loader + invoker.
 *
 * `.claude/agents/<name>.md` files declare their config in YAML
 * frontmatter. Per the Claude Agent SDK 2026 spec:
 *
 *   ---
 *   description: when to use this agent  (required)
 *   tools: Read, Edit, Bash               (allowlist; omit = inherit)
 *   disallowed-tools: Write               (denylist subtraction)
 *   model: sonnet | opus | haiku | inherit
 *   ---
 *
 *   <system prompt body>
 *
 * On `invokeSubAgent` we compute the resolved tool list (intersection
 * of the parent allowedTools and the agent's `tools`, minus
 * `disallowed-tools`) and pass it to the brain.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  BrainPort,
  RuntimeLogger,
  SubAgent,
  SubAgentInvocation,
} from '../types.js';
import { noopLogger } from '../types.js';
import { asStringList, parseFrontmatter } from '../frontmatter.js';

export interface SubAgentLoaderOptions {
  readonly projectPath: string;
  readonly userScopePath?: string;
  readonly logger?: RuntimeLogger;
}

export class SubAgentLoader {
  readonly #projectPath: string;
  readonly #userScopePath: string | undefined;
  readonly #logger: RuntimeLogger;
  readonly #cache = new Map<string, SubAgent>();

  constructor(opts: SubAgentLoaderOptions) {
    this.#projectPath = opts.projectPath;
    this.#userScopePath = opts.userScopePath;
    this.#logger = opts.logger ?? noopLogger;
  }

  invalidate(): void {
    this.#cache.clear();
  }

  async loadSubAgent(name: string): Promise<SubAgent | undefined> {
    const cached = this.#cache.get(name);
    if (cached !== undefined) return cached;
    const path = await this.#resolveAgentPath(name);
    if (path === undefined) return undefined;
    const raw = await readFile(path, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const description =
      typeof data['description'] === 'string' ? (data['description'] as string) : '';
    if (description.length === 0) {
      this.#logger.log('warn', `agent-runtime: sub-agent ${name} missing description`);
    }
    const tools = asStringList(data['tools']);
    const disallowedTools = asStringList(data['disallowed-tools']);
    const model = typeof data['model'] === 'string' ? (data['model'] as string) : undefined;
    const agent: SubAgent = {
      name,
      description,
      ...(tools !== undefined ? { tools } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(model !== undefined ? { model } : {}),
      systemPrompt: body,
      source: path,
    };
    this.#cache.set(name, agent);
    return agent;
  }

  async listSubAgents(): Promise<ReadonlyArray<string>> {
    const names = new Set<string>();
    const dirs = [
      join(this.#projectPath, '.claude', 'agents'),
      ...(this.#userScopePath !== undefined ? [join(this.#userScopePath, 'agents')] : []),
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      try {
        const files = await readdir(dir);
        for (const f of files) {
          if (f.endsWith('.md') && !f.toLowerCase().startsWith('readme')) {
            names.add(f.replace(/\.md$/, ''));
          }
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
   * Invokes the sub-agent in isolation. The brain is called with the
   * computed (allowlist intersected, denylist subtracted) tool set.
   * `parentAllowedTools` is the tool surface the parent agent itself
   * has — pass `undefined` to mean "no parent restriction".
   */
  async invokeSubAgent(args: {
    readonly name: string;
    readonly prompt: string;
    readonly brain: BrainPort;
    readonly parentAllowedTools?: ReadonlyArray<string>;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<SubAgentInvocation> {
    const agent = await this.loadSubAgent(args.name);
    if (agent === undefined) {
      throw new Error(`sub-agent not found: ${args.name}`);
    }
    const resolvedTools = resolveTools(
      args.parentAllowedTools,
      agent.tools,
      agent.disallowedTools,
    );
    const response = await args.brain.call({
      prompt: args.prompt,
      systemPrompt: agent.systemPrompt,
      ...(resolvedTools !== undefined ? { allowedTools: resolvedTools } : {}),
      ...(agent.model !== undefined ? { model: agent.model } : {}),
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    });
    return Object.freeze({
      agentName: args.name,
      prompt: args.prompt,
      resolvedTools: Object.freeze(resolvedTools ?? []),
      ...(agent.model !== undefined ? { model: agent.model } : {}),
      response,
    });
  }

  async #resolveAgentPath(name: string): Promise<string | undefined> {
    const candidates = [
      join(this.#projectPath, '.claude', 'agents', `${name}.md`),
      ...(this.#userScopePath !== undefined
        ? [join(this.#userScopePath, 'agents', `${name}.md`)]
        : []),
    ];
    for (const path of candidates) {
      try {
        const s = await stat(path);
        if (s.isFile()) return path;
      } catch {
        // try next
      }
    }
    return undefined;
  }
}

/**
 * Resolves the effective tool list for a sub-agent invocation.
 *
 *   - If the parent restricts tools, the sub-agent's allowlist is
 *     intersected with it (otherwise the sub-agent can ESCALATE
 *     beyond what the parent had — that would be a privilege bug).
 *   - If the sub-agent has no `tools` field, it inherits the parent's.
 *   - The denylist is always subtracted last.
 *   - Returns `undefined` when no restriction at all should apply.
 */
export function resolveTools(
  parentAllowedTools: ReadonlyArray<string> | undefined,
  agentTools: ReadonlyArray<string> | undefined,
  disallowedTools: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
  let base: ReadonlyArray<string> | undefined;
  if (agentTools === undefined && parentAllowedTools === undefined) {
    base = undefined;
  } else if (agentTools === undefined) {
    base = parentAllowedTools;
  } else if (parentAllowedTools === undefined) {
    base = agentTools;
  } else {
    const parentSet = new Set(parentAllowedTools);
    base = agentTools.filter((t) => parentSet.has(t));
  }
  if (base === undefined) {
    if (disallowedTools === undefined || disallowedTools.length === 0) return undefined;
    // We can't subtract from "everything" — return a sentinel that
    // tells the caller "deny only these".
    return Object.freeze(disallowedTools.map((t) => `!${t}`));
  }
  if (disallowedTools !== undefined && disallowedTools.length > 0) {
    const deny = new Set(disallowedTools);
    base = base.filter((t) => !deny.has(t));
  }
  return Object.freeze([...base]);
}
