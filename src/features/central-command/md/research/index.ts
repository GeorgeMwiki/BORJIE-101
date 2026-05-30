/**
 * MD research — public barrel.
 *
 * Re-exports the synthesis primitive + the three provider factories
 * so external callers (operator-tool-executor, MD orchestrator,
 * future MCP server) import from one stable path:
 *
 *   import {
 *     runDeepResearch,
 *     makeWebSearchProvider,
 *     makeWebFetchProvider,
 *     makeInternalLookupProvider,
 *   } from "@/features/central-command/md/research";
 *
 * @module features/central-command/md/research
 */

export {
  runDeepResearch,
  WEB_SEARCH_HIT_SCHEMA,
  RESEARCH_FINDING_SCHEMA,
  RESEARCH_SYNTHESIS_SCHEMA,
} from "./deep-research";

export type {
  ResearchFinding,
  ResearchSynthesis,
  WebSearchHit,
  WebSearchProvider,
  WebFetchProvider,
  InternalLookupProvider,
  RunDeepResearchInput,
} from "./deep-research";

export { makeWebSearchProvider } from "./web-search-provider";
export type { MakeWebSearchProviderOptions } from "./web-search-provider";

export { makeWebFetchProvider } from "./web-fetch-provider";
export type { MakeWebFetchProviderOptions } from "./web-fetch-provider";

export { makeInternalLookupProvider } from "./internal-lookup-provider";
export type {
  InternalLookupSupabaseLike,
  MakeInternalLookupProviderOptions,
} from "./internal-lookup-provider";
