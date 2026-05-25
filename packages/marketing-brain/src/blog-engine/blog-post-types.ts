/**
 * Blog post shared types.
 */

export type BlogLanguage = 'en' | 'sw';

export interface BlogPost {
  readonly id: string;
  readonly tenantId: string | null;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly bodyMd: string;
  readonly lang: BlogLanguage;
  readonly tags: readonly string[];
  readonly publishedAt: string | null;
  readonly generatedBy: string;
  readonly editedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BlogPostDraft {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly bodyMd: string;
  readonly lang: BlogLanguage;
  readonly tags: readonly string[];
}

export interface GenerateRequest {
  readonly topicKey: string;
  readonly tenantId?: string;
  readonly lang: BlogLanguage;
  readonly tags?: readonly string[];
}
