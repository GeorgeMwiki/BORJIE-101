'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, LLM_REQUEST_TIMEOUT_MS } from '@/lib/api-client';
import type { ReportKind } from '@/lib/types/reports';
import {
  ReportAudioPayloadSchema,
  type ReportAudioPayload,
} from '@/components/reports/report-player-schema';

export interface GenerateReportInput {
  readonly kind: ReportKind;
  readonly rangeStart: string;
  readonly rangeEnd: string;
}

// ---------------------------------------------------------------------------
// FE catalogue kind → gateway `/reports/generate` enum.
//
// The cockpit catalogue carries eight long-form kinds; the gateway accepts
// the canonical seven-value `ReportKind` enum
// (daily|weekly|monthly|investor|bank|board|audit). Map 1:1 where a value
// exists; the two FE-only kinds fall back to their closest narrative window
// (site-daily → daily, community-update → monthly). Never send an
// unsupported value (the gateway rejects it 400).
// ---------------------------------------------------------------------------

type GatewayReportKind =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'investor'
  | 'bank'
  | 'board'
  | 'audit';

const KIND_TO_GATEWAY: Readonly<Record<ReportKind, GatewayReportKind>> = {
  'daily-owner-brief': 'daily',
  'weekly-strategy-memo': 'weekly',
  'monthly-business': 'monthly',
  'site-daily': 'daily',
  'investor-bank': 'investor',
  'board-pack': 'board',
  'audit-pack': 'audit',
  'community-update': 'monthly',
};

/**
 * 202 job ticket returned by `POST /api/v1/mining/reports/generate`. The
 * render is handled out-of-band by the consolidation worker, so there is
 * NO download URL on this response — the UI shows a "queued" state and the
 * generated version surfaces later in `useGeneratedReports()`.
 */
const ReportJobTicketSchema = z.object({
  jobId: z.string(),
  kind: z.string(),
  status: z.literal('queued'),
  note: z.string().optional().default(''),
});

export type ReportJobTicket = z.infer<typeof ReportJobTicketSchema>;

// ---------------------------------------------------------------------------
// Generated report versions list.
//
// Live endpoint: GET /api/v1/mining/reports (filter by kind, since)
// (services/api-gateway/src/routes/mining/reports.hono.ts). Returns the
// `interactive_report_versions` rows for the tenant, newest first.
// `apiRequest` unwraps the gateway `{ success, data }` envelope so the hook
// receives the row array; rows are zod-parsed for defence in depth.
// ---------------------------------------------------------------------------

const GeneratedReportRowSchema = z.object({
  id: z.string(),
  reportInstanceId: z.string(),
  renderKind: z.string(),
  version: z.number().nullable().default(null),
  generatedAt: z.string(),
});

export type GeneratedReportRow = z.infer<typeof GeneratedReportRowSchema>;

const GeneratedReportListSchema = z.array(GeneratedReportRowSchema);

export function useGeneratedReports(opts?: {
  readonly kind?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: ['mining', 'reports', 'list', opts?.kind ?? 'all'] as const,
    queryFn: async ({ signal }): Promise<ReadonlyArray<GeneratedReportRow>> => {
      const qs = new URLSearchParams();
      if (opts?.kind) qs.set('kind', opts.kind);
      qs.set('limit', String(opts?.limit ?? 50));
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/reports?${qs.toString()}`,
        { signal },
      );
      return GeneratedReportListSchema.parse(raw);
    },
    staleTime: 60_000,
  });
}

export function useGenerateReport() {
  return useMutation({
    // Live endpoint: POST /api/v1/mining/reports/generate — returns a 202
    // job ticket {jobId,status:'queued'} (NO download url). The render is
    // dispatched out-of-band by the consolidation worker; the generated
    // version appears later via useGeneratedReports().
    // (services/api-gateway/src/routes/mining/reports.hono.ts).
    mutationFn: async (input: GenerateReportInput): Promise<ReportJobTicket> => {
      const raw = await apiRequest<unknown>('/api/v1/mining/reports/generate', {
        method: 'POST',
        body: {
          kind: KIND_TO_GATEWAY[input.kind],
          asOf: `${input.rangeEnd}T00:00:00.000Z`,
        },
        // Queueing is fast, but the worker dispatch handshake can run a
        // few seconds — use the long timeout to be safe.
        timeoutMs: LLM_REQUEST_TIMEOUT_MS,
      });
      return ReportJobTicketSchema.parse(raw);
    },
  });
}

/**
 * Fetches narration metadata for a given report id. Powers the
 * O-W-18 ReportPlayer. Parses with Zod so a misbehaving gateway
 * cannot crash the surface — we surface the parse failure to
 * react-query's error channel instead.
 */
export function useReportAudio(reportId: string | null) {
  return useQuery({
    queryKey: ['mining', 'reports', 'audio', reportId],
    enabled: reportId !== null,
    queryFn: async (): Promise<ReportAudioPayload> => {
      const raw = await apiRequest<unknown>(
        `/api/v1/mining/reports/${reportId}/audio`,
      );
      return ReportAudioPayloadSchema.parse(raw);
    },
  });
}
