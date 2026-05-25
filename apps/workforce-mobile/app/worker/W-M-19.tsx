import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { Dropdown } from '../../src/forms/Dropdown'
import { GpsCard } from '../../src/forms/GpsCard'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import { useI18n } from '../../src/i18n/useI18n'
import { useLocation } from '../../src/location/useLocation'
import { nearestFence } from '../../src/location/fence'
import { useFingerprintSign } from '../../src/biometric/useFingerprintSign'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import type {
  AttendanceDirection,
  AttendancePayload
} from '../../src/forms/schemas/attendance'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-19'

interface SubmittedRef {
  queueId: string
  direction: AttendanceDirection
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <AttendanceForm />
      </ScreenShell>
    </RoleGuard>
  )
}

function AttendanceForm(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const location = useLocation({ auto: true })
  const fingerprint = useFingerprintSign()
  const [direction, setDirection] = useState<AttendanceDirection>('in')
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  const fence = useMemo(
    () => (location.state.coords ? nearestFence(location.state.coords) : null),
    [location.state.coords]
  )

  const canSubmit = Boolean(location.state.coords) && (fence?.insideFence ?? false)

  const onSubmit = useCallback(async (): Promise<void> => {
    if (!location.state.coords || !fence || !fence.insideFence) {
      return
    }
    setSubmitting(true)
    try {
      const signResult = await fingerprint.sign(t.attendance.fingerprintPrompt)
      if (!signResult) {
        return
      }
      const payload: AttendancePayload = {
        direction,
        gps: {
          latitude: location.state.coords.latitude,
          longitude: location.state.coords.longitude,
          accuracy: location.state.coords.accuracy,
          capturedAt: location.state.coords.capturedAt
        },
        fence: {
          siteId: fence.fence.siteId,
          siteName: fence.fence.siteName,
          insideFence: fence.insideFence,
          distanceMeters: fence.distance
        },
        biometric: {
          method: signResult.method,
          signedAt: signResult.signedAt
        },
        submittedAt: Date.now()
      }
      const entry = await enqueueWrite('attendance', payload)
      setSubmitted({ queueId: entry.id, direction })
    } catch (error) {
      console.error('Attendance submit failed:', error)
    } finally {
      setSubmitting(false)
    }
  }, [direction, fence, fingerprint, location.state.coords, t.attendance.fingerprintPrompt])

  const resetForm = useCallback((): void => {
    fingerprint.reset()
    setSubmitted(null)
  }, [fingerprint])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.attendance.confirmTitle}
            message={
              submitted.direction === 'in'
                ? t.attendance.confirmMessage
                : t.attendance.confirmMessageOut
            }
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
      <Section title="GPS">
        <GpsCard
          state={location.state}
          fence={fence}
          insideLabel={t.attendance.insideFence}
          outsideLabel={t.attendance.outsideFence}
          capturingLabel={t.drillHole.gpsCapturing}
          latLngLabel={t.drillHole.gpsLatLng}
          accuracyLabel={t.drillHole.gpsAccuracy}
          distanceLabel={t.attendance.distance}
          noGpsLabel={t.attendance.noGps}
        />
        <Button
          label={t.attendance.captureGps}
          variant="ghost"
          onPress={() => void location.capture()}
        />
      </Section>
      <Section title={t.attendance.directionLabel}>
        <Dropdown<AttendanceDirection>
          label={t.attendance.directionLabel}
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'in', label: t.attendance.checkIn },
            { value: 'out', label: t.attendance.checkOut }
          ]}
        />
      </Section>
      <View style={styles.bigBtn}>
        <Button
          label={direction === 'in' ? t.attendance.checkIn : t.attendance.checkOut}
          onPress={() => void onSubmit()}
          disabled={!canSubmit}
          loading={submitting}
        />
      </View>
      {!canSubmit && location.state.coords ? (
        <Section title={t.attendance.outsideFence} hint={t.attendance.outsideFenceWarning}>
          <View />
        </Section>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  bigBtn: {
    marginTop: spacing.md
  }
})
