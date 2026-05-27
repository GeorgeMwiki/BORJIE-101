/**
 * In-memory BlackboardCorePort — test fixture.
 *
 * Stand-in for the BLACKBOARD-CORE sibling wave's reader. Honours
 * tenant scoping (returns null for any cross-tenant read).
 *
 * @module @borjie/blackboard-intel/__fixtures__/in-memory-blackboard-core
 */

import type {
  BlackboardCorePort,
  BlackboardPostRef,
} from '../types.js';

export interface InMemoryBlackboardCore extends BlackboardCorePort {
  readonly seed: (posts: ReadonlyArray<BlackboardPostRef>) => void;
  readonly addCrossRef: (sourcePostId: string, refByPostId: string) => void;
  readonly setResolvableCitations: (
    citationIds: ReadonlyArray<string>,
  ) => void;
}

export function createInMemoryBlackboardCore(): InMemoryBlackboardCore {
  const posts: Map<string, BlackboardPostRef> = new Map();
  // Map from source post ID → set of post IDs that reference it.
  const crossRefs: Map<string, Set<string>> = new Map();
  let resolvable: Set<string> = new Set();

  return {
    seed(seedPosts) {
      for (const p of seedPosts) posts.set(p.id, p);
    },
    addCrossRef(sourcePostId, refByPostId) {
      let s = crossRefs.get(sourcePostId);
      if (s === undefined) {
        s = new Set();
        crossRefs.set(sourcePostId, s);
      }
      s.add(refByPostId);
    },
    setResolvableCitations(ids) {
      resolvable = new Set(ids);
    },
    async readPost(tenantId, postId) {
      const p = posts.get(postId);
      if (p === undefined || p.tenantId !== tenantId) return null;
      return p;
    },
    async listCrossRefsTo(tenantId, postId) {
      const ids = crossRefs.get(postId) ?? new Set();
      const out: BlackboardPostRef[] = [];
      for (const id of ids) {
        const p = posts.get(id);
        if (p !== undefined && p.tenantId === tenantId) out.push(p);
      }
      return Object.freeze([...out]);
    },
    async listThread(tenantId, threadId) {
      const out: BlackboardPostRef[] = [];
      for (const p of posts.values()) {
        if (p.tenantId !== tenantId) continue;
        if (p.id === threadId || p.parentThreadId === threadId) {
          out.push(p);
        }
      }
      // Stable order by postedAt asc.
      out.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
      return Object.freeze([...out]);
    },
    async resolveCitations(_tenantId, citationIds) {
      const out: string[] = [];
      for (const id of citationIds) {
        if (resolvable.has(id)) out.push(id);
      }
      return Object.freeze([...out]);
    },
  };
}
