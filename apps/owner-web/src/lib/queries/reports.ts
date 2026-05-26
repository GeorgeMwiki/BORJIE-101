'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
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
