/**
 * Skill discovery — scan platform + tenant roots, parse SKILL.md
 * frontmatter, return a typed list. Lazy: body is NOT loaded here.
 *
 * Conventions:
 *   • platform root: <home>/.borjie/skills/
 *   • tenant  root: <tenantRoot>/tenants/<tenantId>/skills/
 *
 * Each immediate child directory under a root that contains SKILL.md is a
 * skill. Other entries (loose files, dirs without SKILL.md) are ignored
 * silently so partial migrations don't break discovery.
 */

import type {
  DiscoveredSkill,
  LoadedSkill,
  SkillFileSystem,
  SkillScope,
} from './types.js';
import { splitFrontmatter, toSkillManifest } from './parse-manifest.js';

export interface DiscoveryRoots {
  /** Absolute path to the platform skills root (~/.borjie/skills/). */
  readonly platform_root: string;
  /**
   * Optional tenant-scoped roots. Each entry is `{ tenant_id, root }`
   * where `root` is the absolute path to that tenant's skills directory.
   */
  readonly tenant_roots?: ReadonlyArray<{
    readonly tenant_id: string;
    readonly root: string;
  }>;
}

export interface DiscoveryError {
  readonly skill_dir: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly skills: ReadonlyArray<DiscoveredSkill>;
  /** Skill dirs we tried to parse but failed — surfaced for telemetry. */
  readonly errors: ReadonlyArray<DiscoveryError>;
}

/**
 * Run discovery across all roots. Tenant skills are returned alongside
 * platform skills in deterministic name-sorted order so the orchestrator
 * gets a stable view.
 */
export async function discoverSkills(
  fs: SkillFileSystem,
  roots: DiscoveryRoots
): Promise<DiscoveryResult> {
  const errors: Array<DiscoveryError> = [];
  const found: Array<DiscoveredSkill> = [];

  const platformList = await scanRoot(fs, roots.platform_root, { kind: 'platform' }, errors);
  found.push(...platformList);

  for (const tenant of roots.tenant_roots ?? []) {
    const tenantList = await scanRoot(
      fs,
      tenant.root,
      { kind: 'tenant', tenant_id: tenant.tenant_id },
      errors
    );
    found.push(...tenantList);
  }

  found.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return { skills: found, errors };
}

async function scanRoot(
  fs: SkillFileSystem,
  root: string,
  scope: SkillScope,
  errors: Array<DiscoveryError>
): Promise<ReadonlyArray<DiscoveredSkill>> {
  const out: Array<DiscoveredSkill> = [];
  if (!(await fs.isDirectory(root))) {
    return out;
  }
  const entries = await fs.readdir(root);
  for (const entry of entries) {
    const dir = fs.join(root, entry);
    if (!(await fs.isDirectory(dir))) continue;
    const skillMd = fs.join(dir, 'SKILL.md');
    if (!(await fs.isFile(skillMd))) continue;
    try {
      const source = await fs.readFile(skillMd);
      const { raw } = splitFrontmatter(source, skillMd);
      const manifest = toSkillManifest(raw, skillMd);
      out.push({
        manifest,
        skill_md_path: skillMd,
        skill_dir: dir,
        scope,
      });
    } catch (err) {
      errors.push({
        skill_dir: dir,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Materialise the body of a discovered skill. Use this only when the
 * skill is actually invoked — keeps session-startup cost minimal.
 */
export async function loadSkillBody(
  fs: SkillFileSystem,
  skill: DiscoveredSkill
): Promise<LoadedSkill> {
  const source = await fs.readFile(skill.skill_md_path);
  const { body } = splitFrontmatter(source, skill.skill_md_path);
  return { ...skill, body };
}
