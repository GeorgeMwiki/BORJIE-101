/**
 * Module 3 — pre-tool-use-hooks
 * Block destructive globs via canUseTool / PreToolUse hooks.
 */

export * from './types.js';
export { globToMatcher, anyGlobMatches } from './glob-matcher.js';
export { createSelfCodegenHook, asClaudeAgentSdkHook } from './create-hook.js';
