import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import { FingerprintOverlay } from '../../src/biometric/FingerprintOverlay'
import { useI18n } from '../../src/i18n/useI18n'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import type { FingerprintResult } from '../../src/biometric/useFingerprintSign'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'O-M-21'

interface SubmittedRef {
  queueId: string
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SignOffView />
      </ScreenShell>
    </RoleGuard>
  )
}

function SignOffView(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const [overlayOpen, setOverlayOpen] = useState<boolean>(false)
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)

  const onSign = useCallback(
    async (result: FingerprintResult): Promise<void> => {
      setOverlayOpen(false)
      const entry = await enqueueWrite('fingerprint_sign', {
        documentId: 'LV-2231',
        documentKind: 'driver_letter',
        biometric: result,
        submittedAt: Date.now()
      })
      setSubmitted({ queueId: entry.id })
    },
    []
  )

  const reset = useCallback((): void => {
    setSubmitted(null)
  }, [])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.fingerprintSign.success}
            message={t.common.savedOffline}
            refLabel={t.common.reference}
            refValue={submitted.queueId}
            pendingSyncLabel={t.common.pendingSync}
            online={online}
          />
        </Section>
        <Button label={t.common.newEntry} variant="secondary" onPress={reset} />
      </View>
    )
  }

  return (
    <View>
      <Section title={t.fingerprintSign.title}>
        <PlaceholderList
          items={[
            { id: 'd', primary: 'Driver letter · LV-2231', secondary: 'Tani 7 · Geita -> Mwanza' }
          ]}
        />
      </Section>
      <View style={styles.actions}>
        <Button label={t.fingerprintSign.title} onPress={() => setOverlayOpen(true)} />
      </View>
      <FingerprintOverlay
        visible={overlayOpen}
        title={t.fingerprintSign.title}
        subtitle={t.fingerprintSign.subtitle}
        successLabel={t.fingerprintSign.success}
        failedLabel={t.fingerprintSign.failed}
        cancelLabel={t.fingerprintSign.cancel}
        retryLabel={t.fingerprintSign.retry}
        onCancel={() => setOverlayOpen(false)}
        onSuccess={onSign}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  actions: {
    marginTop: spacing.md
  }
})
