/**
 * Skill-library barrel — Voyager-pattern skill memory.
 *
 * Three surfaces:
 *   - `skill-retriever` — embed-and-search over the post-consolidation
 *     `skill_registry` table. Promoted skills become callable.
 *   - `skill-compiler`  — extract a parameterised skill from a session
 *     trace. Auto-suggestion via token overlap. Human-review-gated.
 *   - `tool-affinity-tracker` — re-rank the orchestrator's candidate
 *     tools by historical success on similar intents.
 */

export {
  createSkillRetriever,
  DEFAULT_SKILL_TOP_K,
  DEFAULT_SKILL_MAX_DISTANCE,
  type SkillEntry,
  type SkillRetriever,
  type SkillRetrieverDeps,
  type SkillRetrieverPort,
  type RetrieveSkillsArgs,
} from './skill-retriever.js';

export {
  compileSkill,
  autoSuggestSkill,
  SkillCompileError,
  type CompiledSkill,
  type CompiledSkillStep,
  type SessionTraceStep,
  type CompileSkillOptions,
} from './skill-compiler.js';

export {
  ToolAffinityTracker,
  cosineSimilarity,
  type ToolUsageRecord,
  type AffinityPersistencePort,
  type ToolAffinityTrackerConfig,
} from './tool-affinity-tracker.js';
