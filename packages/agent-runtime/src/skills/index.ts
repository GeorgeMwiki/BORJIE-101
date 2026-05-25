/**
 * Skills registry — Anthropic SKILL.md format with progressive
 * disclosure (Discovery → Activation → Execution).
 *
 * File layout (per `.audit/litfin-sota-2026-05-23/20-zero-friction…`
 * and `https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills`):
 *
 *   .claude/skills/<name>.md           ← single-file skill
 *   .claude/skills/<name>/SKILL.md     ← directory-shaped skill
 *
 * `name` + `description` in frontmatter are required. The `body`
 * (Markdown) is the procedure — loaded only on `invokeSkill`, not on
 * discovery.
 *
 * Optional `.ts` sibling provides programmatic execution; otherwise
 * the skill is "instructions only" — `invokeSkill` returns the body.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RuntimeLogger, Skill, SkillInvoker } from '../types.js';
import { noopLogger } from '../types.js';
import { asStringList, parseFrontmatter } from '../frontmatter.js';

export interface SkillsRegistryOptions {
  readonly projectPath: string;
  readonly logger?: RuntimeLogger;
}

export class SkillsRegistry {
  readonly #projectPath: string;
  readonly #logger: RuntimeLogger;
  readonly #registered = new Map<string, Skill>();

  constructor(opts: SkillsRegistryOptions) {
    this.#projectPath = opts.projectPath;
    this.#logger = opts.logger ?? noopLogger;
  }

  /** Programmatic registration — wins over a file-loaded skill of the same name. */
  registerSkill(skill: {
    readonly name: string;
    readonly description: string;
    readonly allowedTools?: ReadonlyArray<string>;
    readonly disableModelInvocation?: boolean;
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly body?: string;
    readonly invoke?: SkillInvoker;
  }): void {
    const entry: Skill = {
      name: skill.name,
      description: skill.description,
      ...(skill.allowedTools !== undefined ? { allowedTools: skill.allowedTools } : {}),
      ...(skill.disableModelInvocation !== undefined
        ? { disableModelInvocation: skill.disableModelInvocation }
        : {}),
      ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
      body: skill.body ?? '',
      source: 'programmatic',
      ...(skill.invoke !== undefined ? { invoke: skill.invoke } : {}),
    };
    this.#registered.set(skill.name, entry);
  }

  /** Resolves a skill by name, preferring programmatic registrations. */
  async getSkill(name: string): Promise<Skill | undefined> {
    const programmatic = this.#registered.get(name);
    if (programmatic !== undefined) return programmatic;
    return await this.#loadFileSkill(name);
  }

  /**
   * Discovers every skill on disk + every programmatic registration.
   *
   * Per progressive-disclosure, this returns ONLY the discovery-tier
   * metadata (`name`, `description`, `disableModelInvocation`,
   * `allowedTools`) so callers can decide whether to invoke without
   * paying the full body cost.
   */
  async listSkills(): Promise<ReadonlyArray<Pick<Skill, 'name' | 'description' | 'allowedTools' | 'disableModelInvocation'>>> {
    const out = new Map<string, Pick<Skill, 'name' | 'description' | 'allowedTools' | 'disableModelInvocation'>>();
    for (const [name, s] of this.#registered) {
      out.set(name, {
        name,
        description: s.description,
        ...(s.allowedTools !== undefined ? { allowedTools: s.allowedTools } : {}),
        ...(s.disableModelInvocation !== undefined
          ? { disableModelInvocation: s.disableModelInvocation }
          : {}),
      });
    }
    const dir = join(this.#projectPath, '.claude', 'skills');
    if (existsSync(dir)) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        let resolvedPath: string | undefined;
        let name: string | undefined;
        if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.toLowerCase().startsWith('readme')) {
          name = entry.name.replace(/\.md$/, '');
          resolvedPath = join(dir, entry.name);
        } else if (entry.isDirectory()) {
          const sub = join(dir, entry.name, 'SKILL.md');
          if (existsSync(sub)) {
            name = entry.name;
            resolvedPath = sub;
          }
        }
        if (name === undefined || resolvedPath === undefined) continue;
        if (out.has(name)) continue;
        try {
          const raw = await readFile(resolvedPath, 'utf8');
          const { data } = parseFrontmatter(raw);
          const description =
            typeof data['description'] === 'string' ? (data['description'] as string) : '';
          const allowedTools = asStringList(data['allowed-tools']);
          const disable = data['disable-model-invocation'];
          out.set(name, {
            name,
            description,
            ...(allowedTools !== undefined ? { allowedTools } : {}),
            ...(typeof disable === 'boolean' ? { disableModelInvocation: disable } : {}),
          });
        } catch (err) {
          this.#logger.log('warn', `agent-runtime: cannot read skill ${name}`, {
            error: (err as Error).message,
          });
        }
      }
    }
    return Object.freeze([...out.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  /**
   * Invokes a skill. If the skill has a programmatic `invoke`, it is
   * called; otherwise the body Markdown is returned so the caller can
   * route it as additional system context.
   */
  async invokeSkill(args: {
    readonly name: string;
    readonly input?: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly skill: Skill; readonly result: unknown }> {
    const skill = await this.getSkill(args.name);
    if (skill === undefined) {
      throw new Error(`skill not found: ${args.name}`);
    }
    if (skill.disableModelInvocation === true && skill.invoke === undefined) {
      throw new Error(
        `skill ${args.name} has disable-model-invocation=true and no programmatic invoker`,
      );
    }
    if (skill.invoke !== undefined) {
      const result = await skill.invoke({ input: args.input ?? {}, skill });
      return { skill, result };
    }
    return { skill, result: skill.body };
  }

  async #loadFileSkill(name: string): Promise<Skill | undefined> {
    const candidates = [
      join(this.#projectPath, '.claude', 'skills', `${name}.md`),
      join(this.#projectPath, '.claude', 'skills', name, 'SKILL.md'),
    ];
    for (const path of candidates) {
      try {
        const s = await stat(path);
        if (!s.isFile()) continue;
        const raw = await readFile(path, 'utf8');
        const { data, body } = parseFrontmatter(raw);
        const description =
          typeof data['description'] === 'string' ? (data['description'] as string) : '';
        const allowedTools = asStringList(data['allowed-tools']);
        const disable = data['disable-model-invocation'];
        const meta = stripFrontmatterFields(data);
        return Object.freeze({
          name,
          description,
          ...(allowedTools !== undefined ? { allowedTools } : {}),
          ...(typeof disable === 'boolean' ? { disableModelInvocation: disable } : {}),
          ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
          body,
          source: path,
        });
      } catch {
        // try next
      }
    }
    return undefined;
  }
}

function stripFrontmatterFields(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const RESERVED = new Set([
    'name',
    'description',
    'allowed-tools',
    'disable-model-invocation',
  ]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!RESERVED.has(k)) out[k] = v;
  }
  return Object.freeze(out);
}
