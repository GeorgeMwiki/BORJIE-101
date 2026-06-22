'use client';

import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download } from 'lucide-react';
import { Button } from '@borjie/design-system';
import { REPORT_CATALOGUE, type ReportKind } from '@/lib/types/reports';
import { useGenerateReport } from '@/lib/queries/reports';
import { Toast } from '@/components/shared/Toast';

const schema = z.object({
  kind: z.enum([
    'daily-owner-brief',
    'weekly-strategy-memo',
    'monthly-business',
    'site-daily',
    'investor-bank',
    'board-pack',
    'audit-pack',
    'community-update',
  ]),
  rangeStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  rangeEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
});
type FormValues = z.infer<typeof schema>;

/**
 * Report generation form. Owner picks a kind + date range, taps
 * generate, the mutation POSTs to /reports/generate which returns a 202
 * job ticket (queued — the render is dispatched out-of-band by the
 * consolidation worker). We surface a "queued" toast; the finished
 * version appears in the generated-reports list, NOT as an immediate
 * download URL.
 */
export function ReportForm() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      kind: 'daily-owner-brief',
      rangeStart: monthAgo,
      rangeEnd: today,
    },
  });
  const kind = watch('kind') as ReportKind;
  const selected = REPORT_CATALOGUE.find((r) => r.kind === kind);
  const mutation = useGenerateReport();
  const [queuedJobId, setQueuedJobId] = useState<string | null>(null);

  const submit = (values: FormValues): void => {
    mutation.mutate(values, {
      onSuccess: (ticket) => setQueuedJobId(ticket.jobId),
    });
  };

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4" noValidate>
        <fieldset>
          <legend className="text-xs uppercase tracking-wide text-muted-foreground">
            Report type
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            {REPORT_CATALOGUE.map((report) => (
              <label
                key={report.kind}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-surface"
              >
                <input
                  {...register('kind')}
                  type="radio"
                  value={report.kind}
                  className="mt-0.5 accent-warning"
                />
                <span>
                  <span className="block font-medium text-foreground">
                    {report.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {report.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <DateField
            label="Range start"
            register={register('rangeStart')}
            error={errors.rangeStart?.message}
          />
          <DateField
            label="Range end"
            register={register('rangeEnd')}
            error={errors.rangeEnd?.message}
          />
        </div>
        {mutation.isError ? (
          <p role="alert" aria-live="assertive" className="text-xs text-destructive">
            Failed to generate report: {(mutation.error as Error)?.message ?? 'unknown'}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="warning"
          loading={mutation.isPending}
          leftIcon={<Download className="h-4 w-4" />}
        >
          Generate {selected?.title ?? 'report'}
        </Button>
      </form>
      {queuedJobId ? (
        <Toast
          message="Report queued. It will appear in your generated reports when the renderer finishes."
          onDismiss={() => setQueuedJobId(null)}
        />
      ) : null}
    </article>
  );
}

function DateField({
  label,
  register,
  error,
}: {
  readonly label: string;
  readonly register: UseFormRegisterReturn;
  readonly error?: string | undefined;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="date"
        {...register}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
      />
      {error ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
    </label>
  );
}
