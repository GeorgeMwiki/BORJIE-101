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
  /**
   * Chat-as-OS bidirectional parity. Optional for backwards
   * compatibility — older fixtures land without it; the
   * ProvenancePill component is null-safe.
   */
  readonly provenance?: {
    readonly via:
      | 'chat'
      | 'form'
      | 'agent_apply'
      | 'api'
      | 'legacy'
      | 'unknown';
    readonly actorId?: string | null;
    readonly sessionId?: string | null;
    readonly turnId?: string | null;
    readonly requestedAt?: string;
  };
}
