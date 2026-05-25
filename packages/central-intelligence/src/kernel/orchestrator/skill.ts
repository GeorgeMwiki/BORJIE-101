/**
 * Anthropic Agent Skills — SKILL.md format reader + executor.
 *
 * A Skill is a self-contained, model-callable behaviour bundle:
 *
 *   skills/
 *   ├── monthly-arrears-chase/
 *   │   ├── SKILL.md       (YAML frontmatter + prose)
 *   │   ├── prompt.md      (the Skill's prompt template)
 *   │   └── code/          (optional deterministic logic)
 *   │       └── compose-list.ts
 *
 * SKILL.md frontmatter shape:
 *
 *   ---
 *   name: monthly-arrears-chase
 *   description: Compose the month-end arrears chase for a property.
 *   when_to_use: When the user asks for arrears summaries or chase texts.
 *   tools_allowed: [lookupTenantArrears, getMarketRateBand]
 *   tier: pro
 *   ---
 *   ...prose body...
 *
 * This module exposes two primitives:
 *
 *   - `parseSkillManifest(text)` — pure parser, no I/O. Tests don't touch FS.
 *   - `loadSkill(reader, path)`  — composes parseSkillManifest with a
 *                                  caller-supplied file reader.
 *   - `executeSkill(skill, input, deps)` — invokes the skill against an
 *                                  injected LLM + tool registry.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface SkillManifest {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly toolsAllowed: ReadonlyArray<string>;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly body: string;
}

export interface SkillBundle {
  readonly manifest: SkillManifest;
  readonly promptTemplate: string;
  readonly codeFiles: ReadonlyArray<{ path: string; content: string }>;
}

export interface SkillFileReader {
  read(path: string): Promise<string | null>;
  list(prefix: string): Promise<ReadonlyArray<string>>;
}

export interface SkillExecutionDeps {
  /** Caller-supplied LLM caller — the orchestrator's router in production. */
  llm: (args: {
    readonly system: string;
    readonly user: string;
  }) => Promise<{ readonly text: string }>;
  /** Allow-list enforcement — composition root wires real tools. */
  toolAllowed: (name: string) => boolean;
}

export interface SkillExecutionResult {
  readonly skillName: string;
  readonly output: string;
  readonly latencyMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

export class SkillManifestError extends Error {
  constructor(public readonly issue: string) {
    super(`SKILL.md invalid: ${issue}`);
    this.name = 'SkillManifestError';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Parser — minimal YAML-frontmatter aware. We avoid pulling a YAML dep
// since the manifest schema is small + strict.
// ─────────────────────────────────────────────────────────────────────

export function parseSkillManifest(raw: string): SkillManifest {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    throw new SkillManifestError('missing YAML frontmatter delimiters');
  }
  const frontmatter = fmMatch[1] ?? '';
  const body = (fmMatch[2] ?? '').trim();
  const fields = parseFrontmatter(frontmatter);
  const name = required(fields, 'name');
  const description = required(fields, 'description');
  const whenToUse = required(fields, 'when_to_use');
  const toolsAllowed = parseArray(fields['tools_allowed'] ?? '[]');
  const tier = parseTier(fields['tier'] ?? 'free');
  return { name, description, whenToUse, toolsAllowed, tier, body };
}

// ─────────────────────────────────────────────────────────────────────
// loadSkill — combines parser + reader to build a full bundle.
// ─────────────────────────────────────────────────────────────────────

export async function loadSkill(
  reader: SkillFileReader,
  skillDir: string,
): Promise<SkillBundle> {
  const manifestText = await reader.read(`${skillDir}/SKILL.md`);
  if (!manifestText) {
    throw new SkillManifestError(`SKILL.md not found at ${skillDir}`);
  }
  const manifest = parseSkillManifest(manifestText);
  const promptTemplate = (await reader.read(`${skillDir}/prompt.md`)) ?? '';
  const codePaths = await reader.list(`${skillDir}/code/`);
  const codeFiles = await Promise.all(
    codePaths.map(async (p) => ({
      path: p,
      content: (await reader.read(p)) ?? '',
    })),
  );
  return { manifest, promptTemplate, codeFiles };
}

// ─────────────────────────────────────────────────────────────────────
// executeSkill — invoke an LLM with the skill's prompt template +
// caller input. Enforces the tools_allowed allow-list via injected dep.
// ─────────────────────────────────────────────────────────────────────

export async function executeSkill(
  skill: SkillBundle,
  input: string,
  deps: SkillExecutionDeps,
  clock: () => number = Date.now,
): Promise<SkillExecutionResult> {
  for (const tool of skill.manifest.toolsAllowed) {
    if (!deps.toolAllowed(tool)) {
      throw new SkillManifestError(`tool '${tool}' not allowed in this scope`);
    }
  }
  const started = clock();
  const system = [
    `You are executing the '${skill.manifest.name}' skill.`,
    skill.manifest.description,
    skill.manifest.body,
    skill.promptTemplate,
  ]
    .filter(Boolean)
    .join('\n\n');
  const out = await deps.llm({ system, user: input });
  return {
    skillName: skill.manifest.name,
    output: out.text,
    latencyMs: clock() - started,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = stripQuotes(value);
  }
  return out;
}

function stripQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function required(fields: Record<string, string>, key: string): string {
  const v = fields[key];
  if (!v) throw new SkillManifestError(`missing required field: ${key}`);
  return v;
}

function parseArray(raw: string): ReadonlyArray<string> {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new SkillManifestError(`expected JSON-style array, got: ${raw}`);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((s) => stripQuotes(s.trim()));
}

function parseTier(raw: string): SkillManifest['tier'] {
  const v = stripQuotes(raw.trim());
  if (v === 'free' || v === 'pro' || v === 'enterprise') return v;
  throw new SkillManifestError(`unknown tier: ${raw}`);
}
