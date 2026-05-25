/**
 * Skill retriever — Voyager-pattern kernel-side reader.
 *
 * The consolidation worker promotes successful trace clusters into the
 * `skill_registry` table (migration 0133). At inference time the kernel
 * embeds the user's intent and asks this retriever for the top-K
 * matches; the matches are rendered as a system-prompt addendum
 * ("**Available learned skills:** …") so the sensor knows it can
 * re-use a prior pattern.
 *
 * The retriever is a thin port — production wires the Drizzle-backed
 * service from `@borjie/database`; tests inject in-memory fakes.
 *
 * Retrieval cut-offs (chosen against the property-management domain):
 *
 *   - limit:        5      (Voyager paper's top-K sweet spot)
 *   - maxDistance:  0.4    (≈ cosine sim 0.8 for normalised vectors)
 *
 * The renderer truncates to a fixed-byte budget so a chatty skill
 * description doesn't blow up the system prompt.
 */

import type { TextEmbedder } from '../kernel-types.js';

export interface SkillEntry {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly nlDescription: string;
  readonly toolCallTemplate: unknown;
  readonly successCount: number;
  readonly failureCount: number;
  readonly distance: number;
}

export interface SkillRetrieverPort {
  searchByEmbedding(args: {
    readonly tenantId: string | null;
    readonly embedding: ReadonlyArray<number>;
    readonly limit?: number;
    readonly maxDistance?: number;
  }): Promise<ReadonlyArray<SkillEntry>>;
  recordOutcome?(args: {
    readonly skillId: string;
    readonly outcome: 'success' | 'failure';
  }): Promise<void>;
}

export interface RetrieveSkillsArgs {
  readonly tenantId: string | null;
  readonly userMessage: string;
  readonly limit?: number;
  readonly maxDistance?: number;
}

export const DEFAULT_SKILL_TOP_K = 5;
export const DEFAULT_SKILL_MAX_DISTANCE = 0.4;

export interface SkillRetriever {
  retrieve(args: RetrieveSkillsArgs): Promise<ReadonlyArray<SkillEntry>>;
  renderPromptFragment(skills: ReadonlyArray<SkillEntry>): string;
}

export interface SkillRetrieverDeps {
  readonly port: SkillRetrieverPort;
  readonly embedder: TextEmbedder | null;
  /**
   * Max prompt-fragment length in chars. Default 1_500. The fragment is
   * built from the top-K skill names + descriptions; longer than this
   * we truncate the tail. Keeps prompt cost bounded.
   */
  readonly maxFragmentChars?: number;
}

const DEFAULT_FRAGMENT_BUDGET = 1_500;

export function createSkillRetriever(
  deps: SkillRetrieverDeps,
): SkillRetriever {
  const port = deps.port;
  const embedder = deps.embedder;
  const budget = deps.maxFragmentChars ?? DEFAULT_FRAGMENT_BUDGET;

  return {
    async retrieve(args) {
      if (!args.userMessage || !args.userMessage.trim()) return [];
      if (!embedder) return [];
      let embedding: ReadonlyArray<number>;
      try {
        embedding = await embedder.embed(args.userMessage);
      } catch {
        // Embedder unconfigured / network failure — degrade silently to
        // no skills. The kernel proceeds without the addendum.
        return [];
      }
      if (!embedding || embedding.length === 0) return [];

      try {
        const rows = await port.searchByEmbedding({
          tenantId: args.tenantId,
          embedding,
          limit: args.limit ?? DEFAULT_SKILL_TOP_K,
          maxDistance: args.maxDistance ?? DEFAULT_SKILL_MAX_DISTANCE,
        });
        return rows ?? [];
      } catch {
        return [];
      }
    },
    renderPromptFragment(skills) {
      if (!Array.isArray(skills) || skills.length === 0) return '';
      const lines: string[] = ['**Available learned skills:**'];
      let used = lines[0]!.length;
      for (const s of skills) {
        const next = `- ${s.name}: ${s.nlDescription}`;
        if (used + next.length + 1 > budget) {
          lines.push('- …');
          break;
        }
        lines.push(next);
        used += next.length + 1;
      }
      return lines.join('\n');
    },
  };
}
