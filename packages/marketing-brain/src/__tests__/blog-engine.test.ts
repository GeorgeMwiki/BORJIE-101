/**
 * Blog engine tests — generation, store, sitemap.
 */

import { describe, it, expect } from 'vitest';
import {
  BLOG_TOPICS,
  generateBlogPost,
  draftToPost,
  InMemoryPostStore,
  postsToSitemapEntries,
  generateSitemap,
  type BlogPost,
} from '../blog-engine/index.js';

describe('Blog post generator', () => {
  it('lists 5 core topics', () => {
    expect(BLOG_TOPICS.length).toBe(5);
  });

  it('generates an English post with expected structure', () => {
    const draft = generateBlogPost({
      topicKey: 'tenant-default-signs',
      lang: 'en',
    });
    expect(draft.slug).toContain('signs');
    expect(draft.title).toContain('tenant');
    expect(draft.bodyMd).toContain('## Section 1');
    expect(draft.tags).toContain('arrears');
  });

  it('generates a Swahili post', () => {
    const draft = generateBlogPost({
      topicKey: 'tenant-default-signs',
      lang: 'sw',
    });
    expect(draft.lang).toBe('sw');
    expect(draft.bodyMd).toContain('Sehemu');
  });

  it('rejects unknown topics', () => {
    expect(() =>
      generateBlogPost({ topicKey: 'nope', lang: 'en' }),
    ).toThrow(/Unknown blog topic/);
  });

  it('draftToPost includes metadata', () => {
    const draft = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    const post = draftToPost(draft, 'p-1', null, '2026-04-19T10:00:00Z');
    expect(post.id).toBe('p-1');
    expect(post.tenantId).toBeNull();
    expect(post.publishedAt).toBeNull();
  });
});

describe('Post store', () => {
  const now = '2026-04-19T10:00:00Z';

  it('stores and retrieves by slug', async () => {
    const store = new InMemoryPostStore();
    const draft = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    const post = draftToPost(draft, 'p-1', null, now);
    await store.save(post);
    const found = await store.findBySlug(post.slug, null);
    expect(found?.id).toBe('p-1');
  });

  it('rejects duplicate slug in same tenant scope', async () => {
    const store = new InMemoryPostStore();
    const draft = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    const post = draftToPost(draft, 'p-1', null, now);
    await store.save(post);
    const dup: BlogPost = { ...post, id: 'p-2' };
    await expect(store.save(dup)).rejects.toThrow(/Duplicate slug/);
  });

  it('tenant-scoped and platform posts coexist with same slug', async () => {
    const store = new InMemoryPostStore();
    const draft = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    await store.save(draftToPost(draft, 'p-platform', null, now));
    await store.save(draftToPost(draft, 'p-tenant', 't-1', now));
    const platform = await store.findBySlug(draft.slug, null);
    const tenant = await store.findBySlug(draft.slug, 't-1');
    expect(platform?.id).toBe('p-platform');
    expect(tenant?.id).toBe('p-tenant');
  });

  it('publish sets publishedAt', async () => {
    const store = new InMemoryPostStore();
    const draft = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    const post = draftToPost(draft, 'p-1', null, now);
    await store.save(post);
    await store.publish('p-1', '2026-04-20T10:00:00Z');
    const found = await store.findBySlug(post.slug, null);
    expect(found?.publishedAt).toBe('2026-04-20T10:00:00Z');
  });

  it('query filters publishedOnly', async () => {
    const store = new InMemoryPostStore();
    const draftA = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    const draftB = generateBlogPost({ topicKey: 'tender-workflows', lang: 'en' });
    await store.save(draftToPost(draftA, 'p-a', null, now));
    await store.save(draftToPost(draftB, 'p-b', null, now));
    await store.publish('p-a', now);
    const published = await store.query({ tenantId: null, publishedOnly: true });
    expect(published.length).toBe(1);
  });
});

describe('Sitemap generator', () => {
  it('filters unpublished posts', () => {
    const store = new InMemoryPostStore();
    void store;
    const draftA = generateBlogPost({ topicKey: 'far-inspections', lang: 'en' });
    const postA = draftToPost(draftA, 'p-a', null, '2026-04-19T10:00:00Z');
    const postB: BlogPost = { ...postA, id: 'p-b', slug: 'published', publishedAt: '2026-04-19T10:00:00Z' };
    const entries = postsToSitemapEntries([postA, postB], 'https://borjie.com');
    expect(entries.length).toBe(1);
  });

  it('produces well-formed XML', () => {
    const entries = [
      { loc: 'https://borjie.com/blog/a', lastmod: '2026-04-19T10:00:00Z', changefreq: 'weekly' as const, priority: 0.6 },
    ];
    const xml = generateSitemap(entries);
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>https://borjie.com/blog/a</loc>');
  });

  it('escapes special characters', () => {
    const entries = [
      { loc: 'https://borjie.com/blog/a&b', lastmod: '2026-04-19T10:00:00Z', changefreq: 'weekly' as const, priority: 0.6 },
    ];
    const xml = generateSitemap(entries);
    expect(xml).toContain('&amp;');
  });
});
