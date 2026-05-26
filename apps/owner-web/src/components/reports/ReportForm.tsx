'use client';

import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Download, Loader2 } from 'lucide-react';
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
 * generate, the mutation POSTs to /reports/generate (or falls back to
 * a mock 600ms-delayed generator) and surfaces the download URL in a
 * toast.
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
  const [toastUrl, setToastUrl] = useState<string | null>(null);

  const submit = (values: FormValues): void => {
    mutation.mutate(values, {
      onSuccess: (data) => setToastUrl(data.url),
    });
  };

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <form onSubmit={(e) => void handleSubmit(submit)(e)} className="space-y-4">
        <fieldset>
          <legend className="text-xs uppercase tracking-wide text-neutral-500">
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
                  <span className="block text-xs text-neutral-500">
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
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-3 py-2 text-sm text-warning hover:bg-warning-subtle/50 disabled:opacity-60"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Generate {selected?.title ?? 'report'}
        </button>
      </form>
      {toastUrl ? (
        <Toast
          message="Report generated."
          actionLabel="Download PDF"
          onAction={() => window.open(toastUrl, '_blank')}
          onDismiss={() => setToastUrl(null)}
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
  readonly error?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="block text-xs uppercase tracking-wide text-neutral-500">
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
