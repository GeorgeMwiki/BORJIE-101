import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Field } from '../../src/forms/Field'
import { Button } from '../../src/forms/Button'
import { PhotoStrip } from '../../src/forms/PhotoStrip'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import { useI18n } from '../../src/i18n/useI18n'
import { usePhotoPicker, type CapturedMedia } from '../../src/media/usePhotoPicker'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import {
  weighbridgeFormSchema,
  type WeighbridgeForm,
  type WeighbridgePayload
} from '../../src/forms/schemas/weighbridge'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-09'

interface SubmittedRef {
  queueId: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <WeighbridgeFormView />
      </ScreenShell>
    </RoleGuard>
  )
}

function WeighbridgeFormView(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const photoPicker = usePhotoPicker()
  const [photo, setPhoto] = useState<CapturedMedia | null>(null)
  const [video, setVideo] = useState<CapturedMedia | null>(null)
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  const form = useForm<WeighbridgeForm>({
    resolver: zodResolver(weighbridgeFormSchema),
    mode: 'onChange',
    defaultValues: { plate: '', driverName: '' }
  })

  const addPhoto = useCallback(async (): Promise<void> => {
    const media = await photoPicker.takePhoto()
    if (media) {
      setPhoto(media)
    }
  }, [photoPicker])

  const addVideo = useCallback(async (): Promise<void> => {
    const media = await photoPicker.takeVideo(10)
    if (media) {
      setVideo(media)
    }
  }, [photoPicker])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true)
    try {
      const payload: WeighbridgePayload = {
        plate: values.plate.trim().toUpperCase(),
        driverName: values.driverName.trim(),
        photo: photo
          ? { uri: photo.uri, capturedAt: photo.capturedAt, mimeType: photo.mimeType }
          : null,
        video: video
          ? { uri: video.uri, capturedAt: video.capturedAt, mimeType: video.mimeType }
          : null,
        submittedAt: Date.now()
      }
      const entry = await enqueueWrite('weighbridge_capture', payload)
      setSubmitted({ queueId: entry.id })
    } catch (error) {
      console.error('Weighbridge submit failed:', error)
    } finally {
      setSubmitting(false)
    }
  })

  const resetForm = useCallback((): void => {
    form.reset()
    setPhoto(null)
    setVideo(null)
    setSubmitted(null)
  }, [form])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.weighbridge.confirmTitle}
            message={t.weighbridge.confirmMessage}
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
      <Section title={t.weighbridge.plateLabel}>
        <Controller
          control={form.control}
          name="plate"
          render={({ field, fieldState }) => (
            <Field
              label={t.weighbridge.plateLabel}
              value={field.value}
              onChangeText={field.onChange}
              autoCapitalize="characters"
              placeholder={t.weighbridge.platePlaceholder}
              error={fieldState.error ? t.common.required : null}
            />
          )}
        />
        <Controller
          control={form.control}
          name="driverName"
          render={({ field, fieldState }) => (
            <Field
              label={t.weighbridge.driverLabel}
              value={field.value}
              onChangeText={field.onChange}
              autoCapitalize="words"
              placeholder={t.weighbridge.driverPlaceholder}
              error={fieldState.error ? t.common.required : null}
            />
          )}
        />
      </Section>
      <Section title={t.weighbridge.photoLabel}>
        <PhotoStrip
          photos={photo ? [photo] : []}
          onAdd={() => void addPhoto()}
          onRemove={() => setPhoto(null)}
          addLabel={t.weighbridge.photoLabel}
          max={1}
        />
      </Section>
      <Section title={t.weighbridge.videoLabel}>
        <PhotoStrip
          photos={video ? [video] : []}
          onAdd={() => void addVideo()}
          onRemove={() => setVideo(null)}
          addLabel={t.weighbridge.videoLabel}
          max={1}
        />
      </Section>
      <View style={styles.actions}>
        <Button
          label={submitting ? t.common.submitting : t.weighbridge.submit}
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
