/**
 * @borjie/skill-library/filesystem-skills — public API.
 *
 * R1 #8 closure: filesystem-discovered, contextually-loaded skills with a
 * session-scoped allowlist (skills option as a CONTEXT FILTER, not a
 * sandbox — unlisted skills stay on disk).
 */

export type {
  SkillManifest,
  DiscoveredSkill,
  LoadedSkill,
  SkillScope,
  SkillFileSystem,
} from './types.js';

export {
  splitFrontmatter,
  toSkillManifest,
  SkillManifestParseError,
} from './parse-manifest.js';

export {
  discoverSkills,
  loadSkillBody,
  type DiscoveryRoots,
  type DiscoveryError,
  type DiscoveryResult,
} from './discovery.js';

export {
  applyAllowlist,
  filterJurisdictionMisuse,
  type AllowlistResult,
} from './allowlist.js';

export { InMemorySkillFileSystem } from './in-memory-fs.js';
