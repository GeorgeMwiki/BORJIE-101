'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  FormField,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Alert,
} from '@borjie/design-system';
import {
  useCreateMaintenance,
  type UiMaintenanceKind,
} from '@/lib/queries/maintenance';
import { useLocale, pickByLocale } from '@/lib/locale';
import { localizeError } from '@/lib/api-client';
import type { Locale } from '@/lib/locale-shared';
import { fleetMaintenanceStrings as S } from '@/i18n/strings/fleet-maintenance-page';

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
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

const KIND_OPTIONS: ReadonlyArray<UiMaintenanceKind> = [
  'preventive',
  'corrective',
  'inspection',
];

function kindLabel(kind: UiMaintenanceKind, locale: Locale): string {
  if (kind === 'corrective') return pickByLocale(locale, S.kindCorrective);
  if (kind === 'inspection') return pickByLocale(locale, S.kindInspection);
  return pickByLocale(locale, S.kindPreventive);
}

/**
 * Modal form for the "Open new maintenance" action on the fleet
 * maintenance page. Validated with Zod; submits via
 * useCreateMaintenance which invalidates the list query on success.
 * Rendered with the DS Modal (focus trap + ESC) and DS form controls.
 */
export function NewMaintenanceModal({
  open,
  onClose,
  onCreated,
  assetOptions,
  locale: seeded,
}: NewMaintenanceModalProps) {
  const locale = useLocale(seeded);
  const mutation = useCreateMaintenance();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: 'preventive' },
  });

  const kind = watch('kind');

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const onSubmit = (values: FormValues): void => {
    mutation.mutate(
      {
        assetId: values.assetId,
        kind: values.kind,
        ...(values.description !== undefined ? { summary: values.description } : {}),
        ...(values.etaHours !== undefined ? { etaHours: values.etaHours } : {}),
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
    <Modal open={open} onClose={onClose} showCloseButton={false} size="md">
      <ModalHeader
        showCloseButton
        onClose={onClose}
        title={pickByLocale(locale, S.modalTitle)}
        description={pickByLocale(locale, S.modalSubtitle)}
      />
      <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate>
        <ModalBody className="space-y-4">
          <FormField
            label={pickByLocale(locale, S.fieldAsset)}
            {...(errors.assetId ? { error: pickByLocale(locale, S.required) } : {})}
          >
            <Select
              value={watch('assetId') ?? ''}
              onValueChange={(value) =>
                setValue('assetId', value, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={pickByLocale(locale, S.pickAsset)} />
              </SelectTrigger>
              <SelectContent>
                {assetOptions.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={pickByLocale(locale, S.fieldKind)}>
            <Select
              value={kind}
              onValueChange={(value) =>
                setValue('kind', value as UiMaintenanceKind, { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {kindLabel(option, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label={pickByLocale(locale, S.fieldDescription)}>
            <Textarea {...register('description')} rows={3} />
          </FormField>

          <FormField label={pickByLocale(locale, S.fieldEta)}>
            <Input {...register('etaHours')} type="number" min={0} step="0.5" />
          </FormField>

          {mutation.isError ? (
            <Alert variant="error">
              {pickByLocale(locale, S.submitErrorPrefix)}:{' '}
              {mutation.error ? localizeError(mutation.error, locale) : pickByLocale(locale, S.unknownError)}
            </Alert>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {pickByLocale(locale, S.cancel)}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={mutation.isPending}>
            {pickByLocale(locale, S.submit)}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
