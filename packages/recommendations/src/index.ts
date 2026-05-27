/**
 * `@borjie/recommendations` — public surface.
 *
 * SOTA recommendation engine for the Tanzanian mining vertical.
 * Persona: Mr. Mwikila. Companion spec:
 * `Docs/DESIGN/RECOMMENDATIONS_SOTA_2026.md`. Companion migration:
 * `packages/database/drizzle/0071_recommendation_runs.sql`.
 *
 * Five operator-facing wrappers (`domain/mining-reco.ts`):
 *   - buyerMineMatch
 *   - workerSiteMatch
 *   - regulatorFilingMatch
 *   - supplierMineMatch
 *   - trainingCourseWorkerMatch
 *
 * Seven algorithm families behind `RecommendationPort`:
 *   - popularity (cold-start floor)
 *   - content-based (cosine on embeddings)
 *   - user-user CF (Pearson)
 *   - item-item CF (Pearson)
 *   - matrix factorization (SGD-style SVD)
 *   - LLM rerank (port — Claude/Gemini)
 *   - two-tower retriever (port)
 *
 * Two bandits:
 *   - Bernoulli Thompson Sampling (regret proof: Agrawal & Goyal 2012)
 *   - LinUCB (Li, Chu, Langford, Schapire — WWW 2010)
 *
 * One cold-start router (popularity → content → CF), one MMR
 * diversity reranker, one explanation generator (port — default
 * deterministic, Claude wiring optional), and one repository
 * (in-memory + SQL) with tenant-strict isolation.
 */

// Public types — the only shapes consumers should depend on.
export * from './types.js';

// Logger
export { createLogger, logger, type Logger } from './logger.js';

// Util
export { canonicalJSON, sha256Hex, sha256Short } from './util/hash.js';
export { createPRNG, type PRNG } from './util/prng.js';
export { sealResult, type SealArgs } from './util/seal.js';
export {
  cosine,
  dot,
  norm,
  pearson,
  solveSymmetric,
} from './util/linalg.js';

// Algorithms
export {
  createPopularityRecommender,
  type PopularityOptions,
} from './algorithms/popularity.js';
export {
  createContentBasedRecommender,
  type ContentBasedOptions,
} from './algorithms/content-based.js';
export {
  createUserUserCFRecommender,
  type UserUserCFOptions,
} from './algorithms/user-user-cf.js';
export {
  createItemItemCFRecommender,
  type ItemItemCFOptions,
} from './algorithms/item-item-cf.js';
export {
  createMatrixFactorizationRecommender,
  type MatrixFactorizationOptions,
} from './algorithms/matrix-factorization.js';
export {
  createLLMRerankRecommender,
  createDeterministicMockLLM,
  type LLMRerankerPort,
  type LLMRerankRequest,
  type LLMRerankResponse,
  type LLMRerankRecommenderOptions,
} from './algorithms/llm-rerank.js';
export {
  createTwoTowerRecommender,
  createDeterministicMockTwoTower,
  type TwoTowerPort,
  type TwoTowerOptions,
} from './algorithms/two-tower-port.js';
