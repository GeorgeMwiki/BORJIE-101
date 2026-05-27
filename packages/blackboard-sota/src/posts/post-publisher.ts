/**
 * Post publisher — append a post + emit SSE + chain into the region's
 * audit chain.
 *
 * Wave BLACKBOARD-CORE. The hot path of the blackboard pattern.
 * Append-only: writes to `blackboard_posts_v2` and fans the row out
 * over Server-Sent Events to all subscribed consumers. Failure to
 * emit does not roll back the persisted row — durability beats
 * notification.
 *
 * Spec: Docs/DESIGN/BLACKBOARD_SOTA_2026.md §3.4, §9, §11.
 */

import { z } from 'zod';
import {
  BLACKBOARD_CONSTANTS,
  type AppendPostInput,
  type Post,
  type PostsRepository,
} from '../types.js';
import type { PostStream } from './post-stream.js';

const appendInputSchema = z.object({
  tenantId: z.string().min(1),
  regionId: z.string().min(1),
  ksId: z.string().min(1),
  content: z.string().min(1),
  contentEmbedding: z.array(z.number()).optional(),
  structured: z.record(z.unknown()).optional(),
  parentPostId: z.string().optional(),
});

export class EmbeddingDimensionError extends Error {
  constructor(readonly actual: number, readonly expected: number) {
    super(
      `Content embedding must be exactly ${expected} dimensions (got ${actual})`,
    );
    this.name = 'EmbeddingDimensionError';
  }
}

export interface PostPublisher {
  /** Append a post, chain it, and notify subscribers. */
  publish(input: AppendPostInput): Promise<Post>;
}

export interface PostPublisherDeps {
  readonly repository: PostsRepository;
  /** Optional — when supplied, the publisher emits via the stream. */
  readonly stream?: PostStream;
}

export function createPostPublisher(deps: PostPublisherDeps): PostPublisher {
  const { repository, stream } = deps;

  return {
    async publish(rawInput) {
      const input = appendInputSchema.parse(rawInput);
      // Validate embedding dimensionality up-front — production
      // wiring uses OpenAI text-embedding-3-large which is always
      // 1536-dim; a wrong-dim vector would corrupt the index.
      if (input.contentEmbedding !== undefined) {
        if (input.contentEmbedding.length !== BLACKBOARD_CONSTANTS.EMBEDDING_DIM) {
          throw new EmbeddingDimensionError(
            input.contentEmbedding.length,
            BLACKBOARD_CONSTANTS.EMBEDDING_DIM,
          );
        }
      }
      const appendInput: AppendPostInput = {
        tenantId: input.tenantId,
        regionId: input.regionId,
        ksId: input.ksId,
        content: input.content,
        ...(input.contentEmbedding !== undefined
          ? { contentEmbedding: input.contentEmbedding }
          : {}),
        ...(input.structured !== undefined ? { structured: input.structured } : {}),
        ...(input.parentPostId !== undefined
          ? { parentPostId: input.parentPostId }
          : {}),
      };
      const post = await repository.append(appendInput);
      // Best-effort SSE emit — the row is durable regardless.
      stream?.emit(post);
      return post;
    },
  };
}
