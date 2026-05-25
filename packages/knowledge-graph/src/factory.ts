/**
 * `createKnowledgeGraph` — headline composition root.
 *
 * Bundles a store, embedder, brain, and ontology into a single
 * object with the most common operations as methods. Optional
 * dependencies fall back to sensible defaults so a caller can spin
 * up an in-memory KG with one line in tests:
 *
 *   const kg = createKnowledgeGraph({});
 *
 * Production callers wire in:
 *   - `store: Neo4jClient`-based adapter
 *   - `embedder: createTextGraphEmbedder({ textEmbedder: openai })`
 *   - `brain: centralIntelligenceBrain`
 */

import type {
  AnswerWithKG,
  KGBrainPort,
  KGEmbedderPort,
  KGStorePort,
  Node,
  OntologyDef,
  Subgraph,
} from './types.js';
import { createInMemoryStore } from './store/in-memory.js';
import { createMockGraphEmbedder } from './embeddings/embedders.js';
import { realEstateOntology } from './ontology/real-estate.js';
import { answerWithKG } from './graphrag/answer.js';

export interface CreateKnowledgeGraphArgs {
  readonly store?: KGStorePort;
  readonly embedder?: KGEmbedderPort;
  readonly brain?: KGBrainPort;
  readonly ontology?: OntologyDef;
}

export interface KnowledgeGraph {
  readonly store: KGStorePort;
  readonly embedder: KGEmbedderPort;
  readonly ontology: OntologyDef;
  readonly brain: KGBrainPort | null;
  upsertNode(node: Node): Promise<void>;
  ask(args: { readonly question: string; readonly tenantId: string }): Promise<AnswerWithKG>;
  expand(args: {
    readonly seedNodeIds: ReadonlyArray<string>;
    readonly tenantId: string;
    readonly depth?: number;
  }): Promise<Subgraph>;
}

const noopBrain: KGBrainPort = {
  async summarize(args) {
    return args.facts.slice(0, 3).join(' / ') || '(no facts)';
  },
  async answer(args) {
    return `${args.question} :: ${args.context.slice(0, 2).join(' || ')}`;
  },
};

export function createKnowledgeGraph(
  args: CreateKnowledgeGraphArgs,
): KnowledgeGraph {
  const store = args.store ?? createInMemoryStore();
  const embedder = args.embedder ?? createMockGraphEmbedder({ dimension: 64 });
  const ontology = args.ontology ?? realEstateOntology;
  const brain = args.brain ?? noopBrain;

  async function upsertNode(node: Node): Promise<void> {
    await store.upsertNode(node);
  }

  async function ask(askArgs: {
    readonly question: string;
    readonly tenantId: string;
  }): Promise<AnswerWithKG> {
    return answerWithKG({
      question: askArgs.question,
      tenantId: askArgs.tenantId,
      store,
      embedder,
      brain,
    });
  }

  async function expand(expandArgs: {
    readonly seedNodeIds: ReadonlyArray<string>;
    readonly tenantId: string;
    readonly depth?: number;
  }): Promise<Subgraph> {
    const { expandFromSeed } = await import('./graphrag/expand.js');
    return expandFromSeed({
      tenantId: expandArgs.tenantId,
      seedNodeIds: expandArgs.seedNodeIds,
      store,
      ...(expandArgs.depth !== undefined ? { depth: expandArgs.depth } : {}),
    });
  }

  return {
    store,
    embedder,
    ontology,
    brain,
    upsertNode,
    ask,
    expand,
  };
}
