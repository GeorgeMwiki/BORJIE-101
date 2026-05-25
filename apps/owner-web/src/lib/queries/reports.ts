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
        return await apiRequest<GeneratedReport>(
          '/api/v1/owner/reports/generate',
          { method: 'POST', body: input },
        );
      } catch {
        await new Promise((r) => setTimeout(r, 600));
        return generateMockReport(input.kind);
      }
    },
  });
}
