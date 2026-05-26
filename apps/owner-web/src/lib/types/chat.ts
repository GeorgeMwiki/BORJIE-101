/**
 * Master Brain chat surface type shapes.
 *
 * The wire shape that the gateway SSE channel emits.
 */

import type { CeoModeId } from '@/lib/ceo-modes';

export interface ChatEvidence {
  readonly id: string;
  readonly label: string;
  readonly docTitle: string;
  readonly excerpt: string;
  readonly page?: number;
}

export interface ChatBreadcrumb {
  readonly agent: string;
  readonly action: string;
  readonly latencyMs: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'owner' | 'master-brain';
  readonly content: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly breadcrumbs: ReadonlyArray<ChatBreadcrumb>;
  readonly mode: CeoModeId;
  readonly createdAt: string;
}
