'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, FormField } from '@borjie/design-system';
import { useMintAuditPack } from '@/lib/internal/queries/audit-pack';
import { Toast } from '../Toast';
import { useTenantsQuery } from '@/lib/internal/queries/tenants';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

/**
 * Native `<select>` styled with DS tokens. The DS `Select` export is a Radix
 * composite that is NOT compatible with react-hook-form's `register()` ref +
 * native `<option>` children, so we keep the native control (preserving the
 * register data flow) and wrap it in the DS `FormField` for the label / error
 * affordances. Same class string is reused across the form's two pickers.
 */
const SELECT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background';

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

const S = {
  heading: { en: 'Mint regulator audit-pack', sw: 'Tengeneza pakiti ya ukaguzi ya mdhibiti' },
  intent: {
    en: 'Records a pack for the selected tenant. The signed download URL is minted by the bundling step once the evidence set is assembled — no placeholder URL is ever issued.',
    sw: 'Husajili pakiti kwa mteja uliyemchagua. Anwani ya kupakua iliyotiwa saini hutengenezwa na hatua ya ufungaji mara seti ya ushahidi inapokusanywa — hakuna anwani ya muda inayotolewa.',
  },
  tenant: { en: 'Tenant', sw: 'Mteja' },
  regulator: { en: 'Regulator', sw: 'Mdhibiti' },
  selectTenant: { en: 'Select a tenant…', sw: 'Chagua mteja…' },
  minting: { en: 'Minting…', sw: 'Inatengeneza…' },
  mint: { en: 'Mint audit-pack', sw: 'Tengeneza pakiti ya ukaguzi' },
  failed: { en: 'Failed', sw: 'Imeshindwa' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
  recorded: {
    en: 'recorded. Signed URL is issued once the bundle is built.',
    sw: 'imesajiliwa. Anwani iliyotiwa saini hutolewa mara kifurushi kinapojengwa.',
  },
} as const;

export function MintPackForm({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
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
              `Pack ${pack.id.slice(0, 8)}… (${pack.status}) ${pickByLocale(locale, S.recorded)}`,
            );
            reset();
          },
          onError: (err) =>
            setToast(
              `${pickByLocale(locale, S.failed)}: ${
                err instanceof Error ? err.message : pickByLocale(locale, S.unknown)
              }`,
            ),
        }),
      )}
      className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-6 md:grid-cols-3"
    >
      <div className="md:col-span-3">
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {pickByLocale(locale, S.heading)}
        </h3>
        <p className="text-xs text-muted-foreground">{pickByLocale(locale, S.intent)}</p>
      </div>
      <FormField
        label={pickByLocale(locale, S.tenant)}
        name="tenantId"
        required
        {...(formState.errors.tenantId?.message
          ? { error: formState.errors.tenantId.message }
          : {})}
      >
        <select {...register('tenantId')} className={SELECT_CLASS}>
          <option value="">{pickByLocale(locale, S.selectTenant)}</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label={pickByLocale(locale, S.regulator)} name="regulator" required>
        <select {...register('regulator')} className={SELECT_CLASS}>
          <option>TMAA</option>
          <option>NEMC</option>
          <option>BoT</option>
          <option>TRA</option>
          <option>Mining Commission</option>
          <option>Ministry of Minerals</option>
        </select>
      </FormField>
      <div className="flex items-end justify-end">
        <Button
          type="submit"
          loading={mint.isPending}
          disabled={mint.isPending || !formState.isValid}
        >
          {mint.isPending ? pickByLocale(locale, S.minting) : pickByLocale(locale, S.mint)}
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
