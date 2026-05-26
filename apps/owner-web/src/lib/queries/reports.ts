'use client';

import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import type { GeneratedReport, ReportKind } from '@/lib/types/reports';

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
