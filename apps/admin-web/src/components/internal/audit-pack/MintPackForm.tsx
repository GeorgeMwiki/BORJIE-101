'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@borjie/design-system';
import { useMintAuditPack } from '@/lib/internal/queries/audit-pack';
import { Toast } from '../Toast';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';

/**
 * Mint a regulator audit-pack.
 *
 * POSTs { tenantId, regulator } to /api/v1/mining/internal/audit-pack/mint.
 * The pack is created with status='pending' and NO signed URL — the
 * gateway never fabricates one. The download link appears in the issued
 * list only once a real bundling/presign step fills it.
 */
const mintSchema = z.object({
  tenantId: z.string().min(1, 'Pick a tenant'),
  regulator: z.enum([
    'TMAA',
    'NEMC',
    'BoT',
    'TRA',
    'Mining Commission',
    'Ministry of Minerals',
  ]),
});

type MintInput = z.infer<typeof mintSchema>;

export function MintPackForm(): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);
  const tenantsQuery = useTenantsQuery();
  const tenants = tenantsQuery.data?.rows ?? [];
  const mint = useMintAuditPack();

  const { register, handleSubmit, formState, reset } = useForm<MintInput>({
    resolver: zodResolver(mintSchema),
    defaultValues: { tenantId: '', regulator: 'TMAA' },
  });

  return (
    <form
      onSubmit={handleSubmit((data) =>
        mint.mutate(data, {
          onSuccess: (pack) => {
            setToast(
              `Pack ${pack.id.slice(0, 8)}… recorded (status: ${pack.status}). Signed URL is issued once the bundle is built.`,
            );
            reset();
          },
          onError: (err) =>
            setToast(
              `Failed: ${err instanceof Error ? err.message : 'unknown'}`,
            ),
        }),
      )}
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-6 md:grid-cols-3"
    >
      <div className="md:col-span-3">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          Mint regulator audit-pack
        </h3>
        <p className="text-xs text-neutral-500">
          Records a pack for the selected tenant. The signed download URL is
          minted by the bundling step once the evidence set is assembled — no
          placeholder URL is ever issued.
        </p>
      </div>
      <label className="text-sm">
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Tenant
        </span>
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
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Regulator
        </span>
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
      <div className="flex items-end justify-end">
        <Button
          type="submit"
          loading={mint.isPending}
          disabled={mint.isPending || !formState.isValid}
        >
          {mint.isPending ? 'Minting…' : 'Mint audit-pack'}
        </Button>
      </div>
      <Toast
        message={toast}
        tone={mint.isError ? 'danger' : 'success'}
        onDismiss={() => setToast(null)}
      />
    </form>
  );
}
