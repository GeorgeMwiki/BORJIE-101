'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';
import type { GeneratedReport, ReportKind } from '@/lib/types/reports';
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
    // Live endpoint: POST /api/v1/mining/reports
    // (services/api-gateway/src/routes/mining/reports.hono.ts).
    mutationFn: (input: GenerateReportInput) =>
      apiRequest<GeneratedReport>(
        '/api/v1/mining/reports',
        { method: 'POST', body: input },
      ),
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
