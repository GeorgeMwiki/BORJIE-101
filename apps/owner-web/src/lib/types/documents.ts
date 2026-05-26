/**
 * Document chat + onboarding type shapes.
 *
 * Mirrors the gateway document surface (O-W-04 / O-W-21).
 */

export interface DocumentChunk {
  readonly id: string;
  readonly page: number;
  readonly bbox: readonly [number, number, number, number];
  readonly text: string;
}

export interface DocumentRecord {
  readonly id: string;
  readonly title: string;
  readonly mineral: 'gold' | 'coltan' | 'tanzanite';
  readonly type: 'PML' | 'EPP' | 'assay' | 'invoice' | 'MoU' | 'audit';
  readonly pages: number;
  readonly uploadedAt: string;
  readonly url: string | null;
  readonly chunks: ReadonlyArray<DocumentChunk>;
}
