/**
 * Public types for the onboarding jumpstart service.
 * Wave COMPANY-BRAIN (Y-D — Day-1 super-powered demo end-to-end).
 *
 * The jumpstart fires exactly once per tenant — right after the first
 * `corpus_doc_uploads.status='indexed'` row lands. It generates a
 * "Day-1 insights" card the cockpit chat panel inlines (header +
 * top stats + accept-on-tap proposals) AND publishes a
 * `mining.celebrate` cockpit-bus event so any open cockpit screen
 * also shows the welcome pulse.
 *
 * Subsequent uploads do NOT re-trigger the jumpstart (the inferrer
 * still runs on every ingest — the jumpstart is the one-shot welcome).
 */

import type { IngestIntent } from '../ingestion-intent-inferrer/types.js';

export interface JumpstartCard {
  readonly headerEn: string;
  readonly headerSw: string;
  readonly subheaderEn: string;
  readonly subheaderSw: string;
  /** Top-line metrics rendered in the inline card. */
  readonly metrics: ReadonlyArray<{
    readonly labelEn: string;
    readonly labelSw: string;
    readonly value: string;
  }>;
  /** Forward the inferrer's intent untouched — the card's CTA grid. */
  readonly intent: IngestIntent;
}

export interface JumpstartResult {
  readonly fired: boolean;
  /** When fired=false, this carries the reason ('already_demoed', etc.). */
  readonly skippedReason: string | null;
  readonly card: JumpstartCard | null;
  /** Per-tenant onboarding-state row after the upsert. */
  readonly state: {
    readonly tenantId: string;
    readonly status: 'pending' | 'ready' | 'demoed' | 'dismissed';
    readonly firstIngestAt: string | null;
    readonly jumpstartedAt: string | null;
  };
}

export interface JumpstartInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly uploadId: string;
  /** The IngestIntent the inferrer just produced for THIS upload. */
  readonly intent: IngestIntent;
  /** Filename — drives the header copy. */
  readonly filename: string;
  /** Summary text the summarizer produced (en + sw). */
  readonly summaryEn: string | null;
  readonly summarySw: string | null;
}
