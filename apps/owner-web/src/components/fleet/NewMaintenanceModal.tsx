'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, X } from 'lucide-react';
import {
  useCreateMaintenance,
  type UiMaintenanceKind,
} from '@/lib/queries/maintenance';

const schema = z.object({
  assetId: z.string().min(1, 'required'),
  kind: z.enum(['preventive', 'corrective', 'inspection']),
  description: z.string().max(2000).optional(),
  etaHours: z.coerce.number().nonnegative().optional(),
});

type FormValues = z.infer<typeof schema>;

interface NewMaintenanceModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: () => void;
  readonly assetOptions: ReadonlyArray<string>;
}

const KIND_LABEL_SW: Readonly<Record<UiMaintenanceKind, string>> = {
  preventive: 'Kinga',
  corrective: 'Marekebisho',
  inspection: 'Ukaguzi',
};

const KIND_LABEL_EN: Readonly<Record<UiMaintenanceKind, string>> = {
  preventive: 'Preventive',
  corrective: 'Corrective',
  inspection: 'Inspection',
};

/**
 * Modal form for the "Open new maintenance" action on the fleet
 * maintenance page. Validated with Zod; submits via
 * useCreateMaintenance which invalidates the list query on success.
 */
export function NewMaintenanceModal({
  open,
  onClose,
  onCreated,
  assetOptions,
}: NewMaintenanceModalProps) {
  const mutation = useCreateMaintenance();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: 'preventive' },
  });

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  const onSubmit = (values: FormValues): void => {
    mutation.mutate(
      {
        assetId: values.assetId,
        kind: values.kind,
        summary: values.description,
        etaHours: values.etaHours,
      },
      {
        onSuccess: () => {
          onCreated();
          onClose();
        },
      },
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Open new maintenance / Anza matengenezo"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Open new maintenance
            </h2>
            <p className="text-xs text-neutral-500">Anza matengenezo mapya</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-neutral-500 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <form
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="space-y-3 px-5 py-4"
        >
          <label className="block text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              Asset / Mali
            </span>
            <select
              {...register('assetId')}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
            >
              <option value="">— pick / chagua —</option>
              {assetOptions.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            {errors.assetId ? (
              <span className="mt-1 block text-xs text-destructive">
                {errors.assetId.message}
              </span>
            ) : null}
          </label>
          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-neutral-500">
              Kind / Aina
            </legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['preventive', 'corrective', 'inspection'] as const).map((kind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground hover:bg-surface"
                >
                  <input
                    {...register('kind')}
                    type="radio"
                    value={kind}
                    className="accent-warning"
                  />
                  <span>
                    {KIND_LABEL_EN[kind]}
                    <span className="ml-1 text-neutral-500">/ {KIND_LABEL_SW[kind]}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              Description / Maelezo
            </span>
            <textarea
              {...register('description')}
              rows={3}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-xs uppercase tracking-wide text-neutral-500">
              ETA hours / Masaa
            </span>
            <input
              {...register('etaHours')}
              type="number"
              min={0}
              step="0.5"
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
            />
          </label>
          {mutation.isError ? (
            <p className="text-xs text-destructive">
              Failed: {(mutation.error as Error)?.message ?? 'unknown'}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-surface"
            >
              Cancel / Ghairi
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-warning bg-warning-subtle/30 px-3 py-1.5 text-xs text-warning hover:bg-warning-subtle/50 disabled:opacity-60"
            >
              {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Open maintenance / Anza
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
