/**
 * @borjie/skill-library — Phase K-C public API.
 *
 * Closes:
 *   • R1 #7 — Programmatic subagents per-query with full isolation contract
 *   • R1 #8 — Filesystem-discovered, contextually-loaded skills with allowlist
 *   • R1 #9 — MCP ToolSearch for deferred MCP schema loading
 *   • R3 #1 + #3 — Voyager-style executable code skill library
 *
 * The package is dependency-free at runtime (only `zod` for input
 * validation, currently unused in v0.1). Tests do not touch node:fs;
 * they use the in-memory test stubs exported per module.
 *
 * Sub-path exports are also available:
 *   import { spawnSubAgent } from '@borjie/skill-library/subagent-spawn';
 *   import { discoverSkills }  from '@borjie/skill-library/filesystem-skills';
 *   import { McpToolRegistry } from '@borjie/skill-library/mcp-tool-search';
 *   import { VoyagerSkillLibrary, BUILTIN_SKILLS } from '@borjie/skill-library/voyager-library';
 *   import { BUILTIN_SKILLS } from '@borjie/skill-library/builtin-skills';
 */

export * from './subagent-spawn/index.js';
export * from './filesystem-skills/index.js';
export * from './mcp-tool-search/index.js';
export * from './voyager-library/index.js';
// builtin-skills last so its own exports (BUILTIN_SKILLS, embed,
// skill helpers) override nothing — no symbol collisions exist after
// the dispatch-maintenance rename to `rankVendorCandidates`.
export * from './builtin-skills/index.js';
