'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Toast } from '../Toast';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';

const mintSchema = z.object({
  tenantId: z.string().min(1, 'Pick a tenant'),
  regulator: z.enum(['TMAA', 'NEMC', 'BoT', 'TRA', 'Mining Commission', 'Ministry of Minerals']),
  expiresIn: z.enum(['24h', '7d', '30d']),
});

type MintInput = z.infer<typeof mintSchema>;

interface MintResult {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string;
}

export function MintPackForm(): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);
  const tenantsQuery = useTenantsQuery();
  const tenants = tenantsQuery.data?.rows ?? [];
  const { register, handleSubmit, formState } = useForm<MintInput>({
    resolver: zodResolver(mintSchema),
    defaultValues: { tenantId: '', regulator: 'TMAA', expiresIn: '7d' },
  });

  const mint = useMutation({
    mutationFn: async (input: MintInput): Promise<MintResult> => {
      const res = await apiClient.post<MintResult>('/audit-pack/mint', input);
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
  });

  return (
    <form
      onSubmit={handleSubmit((data) =>
        mint.mutate(data, {
          onSuccess: (res) =>
            setToast(`Pack ${res.id} minted, expires ${res.expiresAt.replace('T', ' ').slice(0, 16)}`),
          onError: (err) => setToast(`Failed: ${err instanceof Error ? err.message : 'unknown'}`),
        })
      )}
      className="rounded-lg border border-border bg-surface p-6 grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <label className="text-sm">
        <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Tenant</span>
        <select
          {...register('tenantId')}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          <option value="">Select a tenant…</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Regulator</span>
        <select
          {...register('regulator')}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          <option>TMAA</option>
          <option>NEMC</option>
          <option>BoT</option>
          <option>TRA</option>
          <option>Mining Commission</option>
          <option>Ministry of Minerals</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Expires in</span>
        <select
          {...register('expiresIn')}
          className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
        >
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
        </select>
      </label>
      <div className="md:col-span-3 flex justify-end">
        <button
          type="submit"
          disabled={mint.isPending || !formState.isValid}
          className="rounded-md bg-signal-500 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-signal-500/90 disabled:opacity-50"
        >
          {mint.isPending ? 'Minting…' : 'Mint signed URL'}
        </button>
      </div>
      <Toast message={toast} tone={mint.isError ? 'danger' : 'success'} onDismiss={() => setToast(null)} />
    </form>
  );
}
