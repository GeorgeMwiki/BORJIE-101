/**
 * Post Store — Postgres-backed in production, in-memory for tests.
 *
 * Keeps posts scoped by tenantId (null = platform-wide post). Unique slug
 * constraint is enforced at the storage layer (and the migration).
 */

import type { BlogPost } from './blog-post-types.js';

export interface PostQuery {
  readonly tenantId?: string | null;
  readonly lang?: BlogPost['lang'];
  readonly tag?: string;
  readonly slug?: string;
  readonly publishedOnly?: boolean;
  readonly limit?: number;
}

export interface PostStorage {
  save(post: BlogPost): Promise<void>;
  findBySlug(slug: string, tenantId: string | null): Promise<BlogPost | null>;
  query(q: PostQuery): Promise<readonly BlogPost[]>;
  publish(postId: string, publishedAt: string): Promise<void>;
  edit(postId: string, body: string, editedBy: string, now: string): Promise<void>;
}

export class InMemoryPostStore implements PostStorage {
  private readonly posts = new Map<string, BlogPost>();

  async save(post: BlogPost): Promise<void> {
    const dupKey = `${post.tenantId ?? 'platform'}::${post.slug}`;
    for (const existing of this.posts.values()) {
      const existingKey = `${existing.tenantId ?? 'platform'}::${existing.slug}`;
      if (existingKey === dupKey && existing.id !== post.id) {
        throw new Error(`Duplicate slug: ${post.slug}`);
      }
    }
    this.posts.set(post.id, post);
  }

  async findBySlug(
    slug: string,
    tenantId: string | null,
  ): Promise<BlogPost | null> {
    for (const p of this.posts.values()) {
      if (p.slug === slug && p.tenantId === tenantId) return p;
    }
    return null;
  }

  async query(q: PostQuery): Promise<readonly BlogPost[]> {
    const rows = Array.from(this.posts.values()).filter((p) => {
      if (q.tenantId !== undefined && p.tenantId !== q.tenantId) return false;
      if (q.lang && p.lang !== q.lang) return false;
      if (q.tag && !p.tags.includes(q.tag)) return false;
      if (q.slug && p.slug !== q.slug) return false;
      if (q.publishedOnly && !p.publishedAt) return false;
      return true;
    });
    rows.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    const limit = q.limit ?? 100;
    return rows.slice(0, limit);
  }

  async publish(postId: string, publishedAt: string): Promise<void> {
    const existing = this.posts.get(postId);
    if (!existing) return;
    this.posts.set(postId, { ...existing, publishedAt, updatedAt: publishedAt });
  }

  async edit(
    postId: string,
    body: string,
    editedBy: string,
    now: string,
  ): Promise<void> {
    const existing = this.posts.get(postId);
    if (!existing) return;
    this.posts.set(postId, {
      ...existing,
      bodyMd: body,
      editedBy,
      updatedAt: now,
    });
  }
}
