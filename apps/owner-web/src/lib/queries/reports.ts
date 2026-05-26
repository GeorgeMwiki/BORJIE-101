'use client';

import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { generateMockReport, type GeneratedReport, type ReportKind } from '@/lib/mocks/reports';

export interface GenerateReportInput {
  readonly kind: ReportKind;
  readonly rangeStart: string;
  readonly rangeEnd: string;
}

export function useGenerateReport() {
  return useMutation({
    mutationFn: async (input: GenerateReportInput): Promise<GeneratedReport> => {
      try {
        // Live endpoint: POST /api/v1/mining/reports
        // (services/api-gateway/src/routes/mining/reports.hono.ts).
        return await apiRequest<GeneratedReport>(
          '/api/v1/mining/reports',
          { method: 'POST', body: input },
        );
      } catch {
        await new Promise((r) => setTimeout(r, 600));
        return generateMockReport(input.kind);
      }
    },
  });
}
