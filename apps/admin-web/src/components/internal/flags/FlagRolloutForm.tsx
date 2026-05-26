'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';

const rolloutSchema = z.object({
  rolloutPct: z.coerce.number().int().min(0).max(100),
});

type RolloutInput = z.infer<typeof rolloutSchema>;

interface FlagRolloutFormProps {
  readonly flagKey: string;
  readonly current: number;
}

export function FlagRolloutForm({ flagKey, current }: FlagRolloutFormProps): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<RolloutInput>({
    resolver: zodResolver(rolloutSchema),
    defaultValues: { rolloutPct: current },
  });

  const mutate = useMutation({
    mutationFn: async (input: RolloutInput) => {
      const res = await apiClient.patch<{ readonly key: string; readonly rolloutPct: number }>(
        `/flags/${flagKey}`,
        input,
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
  });

  return (
    <form
      onSubmit={handleSubmit((data) =>
        mutate.mutate(data, {
          onSuccess: (res) => setToast(`${flagKey} rolled out to ${res.rolloutPct}%`),
          onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
        })
      )}
      className="flex items-center gap-2"
    >
      <input
        {...register('rolloutPct', { valueAsNumber: true })}
        type="number"
        min={0}
        max={100}
        aria-label={`${flagKey} rollout percent`}
        className="w-16 rounded-md border border-border bg-surface-sunken px-2 py-1 text-xs text-foreground tabular-nums"
      />
      <button
        type="submit"
        disabled={mutate.isPending || !formState.isValid}
        className="text-xs text-signal-500 hover:underline disabled:opacity-50"
      >
        {mutate.isPending ? 'Saving…' : 'Save'}
      </button>
      <Toast message={toast} tone={mutate.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </form>
  );
}
