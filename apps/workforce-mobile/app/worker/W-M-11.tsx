import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Field } from '../../src/forms/Field'
import { Button } from '../../src/forms/Button'
import { Dropdown } from '../../src/forms/Dropdown'
import { PhotoStrip } from '../../src/forms/PhotoStrip'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import { useI18n } from '../../src/i18n/useI18n'
import { usePhotoPicker, type CapturedMedia } from '../../src/media/usePhotoPicker'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import {
  fuelLogFormSchema,
  type FuelLogForm,
  type FuelLogPayload
} from '../../src/forms/schemas/fuelLog'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-11'

interface SubmittedRef {
  queueId: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <FuelLogForm />
      </ScreenShell>
    </RoleGuard>
  )
}

function FuelLogForm(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const photoPicker = usePhotoPicker()
  const [meterPhoto, setMeterPhoto] = useState<CapturedMedia | null>(null)
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  const assetOptions = [
    { value: 'excavator-1', label: t.fuelLog.asset1 },
    { value: 'excavator-2', label: t.fuelLog.asset2 },
    { value: 'loader-1', label: t.fuelLog.asset3 },
    { value: 'truck-1', label: t.fuelLog.asset4 },
    { value: 'truck-2', label: t.fuelLog.asset5 },
    { value: 'generator-1', label: t.fuelLog.asset6 }
  ]

  const form = useForm<FuelLogForm>({
    resolver: zodResolver(fuelLogFormSchema),
    mode: 'onChange',
    defaultValues: {
      assetId: 'excavator-1',
      litres: ''
    }
  })

  const addPhoto = useCallback(async (): Promise<void> => {
    const media = await photoPicker.takePhoto()
    if (media) {
      setMeterPhoto(media)
    }
  }, [photoPicker])

  const removePhoto = useCallback((): void => {
    setMeterPhoto(null)
  }, [])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true)
    try {
      const payload: FuelLogPayload = {
        assetId: values.assetId,
        litres: Number(values.litres),
        meterPhoto: meterPhoto
          ? {
              uri: meterPhoto.uri,
              capturedAt: meterPhoto.capturedAt,
              mimeType: meterPhoto.mimeType
            }
          : null,
        submittedAt: Date.now()
      }
      const entry = await enqueueWrite('fuel_log', payload)
      setSubmitted({ queueId: entry.id })
    } catch (error) {
      console.error('Fuel log submit failed:', error)
    } finally {
      setSubmitting(false)
    }
  })

  const resetForm = useCallback((): void => {
    form.reset()
    setMeterPhoto(null)
    setSubmitted(null)
  }, [form])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.fuelLog.confirmTitle}
            message={t.fuelLog.confirmMessage}
            refLabel={t.common.reference}
            refValue={submitted.queueId}
            pendingSyncLabel={t.common.pendingSync}
            online={online}
          />
        </Section>
        <Button label={t.common.newEntry} variant="secondary" onPress={resetForm} />
      </View>
    )
  }

  return (
    <View>
      <Section title={t.fuelLog.assetLabel}>
        <Controller
          control={form.control}
          name="assetId"
          render={({ field, fieldState }) => (
            <Dropdown
              label={t.fuelLog.assetLabel}
              value={field.value}
              onChange={field.onChange}
              options={assetOptions}
              placeholder={t.fuelLog.assetPlaceholder}
              error={fieldState.error ? t.common.required : null}
            />
          )}
        />
        <Controller
          control={form.control}
          name="litres"
          render={({ field, fieldState }) => (
            <Field
              label={t.fuelLog.litresLabel}
              value={field.value}
              onChangeText={field.onChange}
              keyboardType="decimal-pad"
              placeholder={t.fuelLog.litresPlaceholder}
              error={fieldState.error ? t.common.required : null}
            />
          )}
        />
      </Section>
      <Section title={t.fuelLog.meterPhoto} hint={t.fuelLog.meterPhotoHint}>
        <PhotoStrip
          photos={meterPhoto ? [meterPhoto] : []}
          onAdd={() => void addPhoto()}
          onRemove={removePhoto}
          addLabel={t.fuelLog.meterPhoto}
          max={1}
        />
      </Section>
      <View style={styles.actions}>
        <Button
          label={submitting ? t.common.submitting : t.fuelLog.submit}
          onPress={() => void onSubmit()}
          loading={submitting}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  actions: {
    marginTop: spacing.md
  }
})
