/**
 * Filesystem-discovered skill types — closes R1 gap #8.
 *
 * A skill is a DIRECTORY on disk:
 *
 *   <skill_dir>/
 *     SKILL.md            — REQUIRED. YAML frontmatter + Markdown body.
 *     <entrypoint>.ts     — OPTIONAL. Executable code skill (path declared in frontmatter).
 *     prompts/*.md        — OPTIONAL. Sub-prompts the skill can pull in.
 *
 * Discovery walks two roots:
 *
 *   ~/.borjie/skills/                 — platform-wide (user scope)
 *   tenants/<tenantId>/skills/            — tenant-scoped (per-tenant scope)
 *
 * At session start, every SKILL.md is parsed (cheap — frontmatter only) so
 * the orchestrator knows the metadata; the BODY is loaded only when the
 * skill is invoked (contextually loaded, mirroring Claude Code's pattern).
 *
 * A session-scoped allowlist `skills: ['handle-late-rent', 'compile-weekly-report']`
 * filters which skills are SURFACED to the model. Skills not in the
 * allowlist remain on disk (Read/Bash can still reach them) but the model
 * is not told about them.
 */

/**
 * SKILL.md frontmatter schema. Strictly typed so a bad manifest is caught
 * at discovery, not at runtime.
 */
export interface SkillManifest {
  /**
   * Stable slug, e.g. "handle-late-rent". Must match
   * `/^[a-z][a-z0-9_-]{1,63}$/`. Used as the allowlist key.
   */
  readonly name: string;
  /** One-line summary visible to the model in skill catalogs. */
  readonly description: string;
  /**
   * When the model should pick this skill. Short imperative phrases.
   * Multiple cues allowed (e.g. ["tenant 5+ days late", "missed rent"]).
   */
  readonly when_to_use: ReadonlyArray<string>;
  /**
   * Tool allowlist for THIS skill while it executes. The orchestrator
   * unions this with the session's broader allowlist; deny still wins.
   */
  readonly allowed_tools: ReadonlyArray<string>;
  /**
   * If true, the skill's prompts contain jurisdiction-specific language
   * (KE law, TZ law, etc.) and must be parameterized by tenant
   * jurisdiction at invocation time. Used by the orchestrator to refuse
   * loading a KE-only skill into a TZ tenant.
   */
  readonly jurisdiction_aware: boolean;
  /**
   * Relative path (from skill dir) to the executable code entrypoint.
   * Optional — pure-prompt skills omit this. Path is sandboxed to skill
   * dir (no `..` escapes); the loader verifies.
   */
  readonly code_entrypoint?: string;
  /**
   * Optional version stamp for upgrade detection in the long-term
   * Voyager-style library.
   */
  readonly version?: string;
}

/**
 * A fully-resolved skill record after discovery + parse. The `body` is
 * loaded lazily; here we just hold the absolute path so the orchestrator
 * can defer the read.
 */
export interface DiscoveredSkill {
  readonly manifest: SkillManifest;
  /** Absolute path to the SKILL.md file. */
  readonly skill_md_path: string;
  /** Absolute path to the skill directory. */
  readonly skill_dir: string;
  /** Discovery scope so the orchestrator can apply tenant rules. */
  readonly scope: SkillScope;
}

export type SkillScope =
  | { readonly kind: 'platform' }
  | { readonly kind: 'tenant'; readonly tenant_id: string };

/**
 * Loaded skill — body materialised. Returned by `loadSkillBody`.
 */
export interface LoadedSkill extends DiscoveredSkill {
  readonly body: string;
}

/**
 * Filesystem operations the loader needs. Abstracted for testability —
 * the production wiring uses `node:fs/promises`, tests use the in-memory
 * stub in `in-memory-fs.ts`.
 */
export interface SkillFileSystem {
  /** Returns true if path exists as a directory. */
  isDirectory(path: string): Promise<boolean>;
  /** Returns true if path exists as a file. */
  isFile(path: string): Promise<boolean>;
  /** Lists direct child entries of a directory (names only, not full paths). */
  readdir(path: string): Promise<ReadonlyArray<string>>;
  /** Reads UTF-8 text content of a file. */
  readFile(path: string): Promise<string>;
  /** Joins path segments using forward-slash for cross-platform tests. */
  join(...segments: ReadonlyArray<string>): string;
}
