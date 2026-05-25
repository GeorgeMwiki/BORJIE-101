import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { LayerList, EMPTY_DRAFT, type DraftLayer } from '../../src/forms/LayerList'
import { GpsCard } from '../../src/forms/GpsCard'
import { ConfirmationCard } from '../../src/forms/ConfirmationCard'
import { DrillHoleFields } from '../../src/forms/drillHoleFields'
import { useI18n } from '../../src/i18n/useI18n'
import { useLocation } from '../../src/location/useLocation'
import { nearestFence } from '../../src/location/fence'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { enqueueWrite } from '../../src/sync/queue'
import {
  drillHoleFormSchema,
  generateHoleId,
  type DrillHoleForm,
  type DrillHolePayload,
  type DrillLayer
} from '../../src/forms/schemas/drillHole'
import { spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-07'

interface SubmittedRef {
  queueId: string
}

function newLayerId(): string {
  return `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <DrillHoleFormView />
      </ScreenShell>
    </RoleGuard>
  )
}

function DrillHoleFormView(): JSX.Element {
  const { t } = useI18n()
  const { online } = useOnlineStatus()
  const location = useLocation({ auto: true })
  const [layers, setLayers] = useState<ReadonlyArray<DrillLayer>>([])
  const [draft, setDraft] = useState<DraftLayer>(EMPTY_DRAFT)
  const [submitted, setSubmitted] = useState<SubmittedRef | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)

  const fence = useMemo(
    () => (location.state.coords ? nearestFence(location.state.coords) : null),
    [location.state.coords]
  )

  const defaultHoleId = useMemo(() => generateHoleId(), [])

  const form = useForm<DrillHoleForm>({
    resolver: zodResolver(drillHoleFormSchema),
    mode: 'onChange',
    defaultValues: {
      holeId: defaultHoleId,
      kind: 'diamond',
      depth: '',
      sampleTag: ''
    }
  })

  const addLayer = useCallback((): void => {
    const fromMeters = Number(draft.fromMeters)
    const toMeters = Number(draft.toMeters)
    if (
      draft.type.trim().length === 0 ||
      Number.isNaN(fromMeters) ||
      Number.isNaN(toMeters) ||
      toMeters <= fromMeters
    ) {
      return
    }
    const next: DrillLayer = {
      id: newLayerId(),
      type: draft.type.trim(),
      fromMeters,
      toMeters
    }
    setLayers((current) => [...current, next])
    setDraft(EMPTY_DRAFT)
  }, [draft])

  const removeLayer = useCallback((id: string): void => {
    setLayers((current) => current.filter((layer) => layer.id !== id))
  }, [])

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true)
    try {
      const payload: DrillHolePayload = {
        holeId: values.holeId,
        kind: values.kind,
        depthMeters: Number(values.depth),
        sampleTag: values.sampleTag ?? '',
        layers,
        gps: location.state.coords
          ? {
              latitude: location.state.coords.latitude,
              longitude: location.state.coords.longitude,
              accuracy: location.state.coords.accuracy,
              capturedAt: location.state.coords.capturedAt
            }
          : null,
        fence: fence
          ? {
              siteId: fence.fence.siteId,
              siteName: fence.fence.siteName,
              insideFence: fence.insideFence,
              distanceMeters: fence.distance
            }
          : null,
        submittedAt: Date.now()
      }
      const entry = await enqueueWrite('drill_hole', payload)
      setSubmitted({ queueId: entry.id })
    } catch (error) {
      console.error('Drill hole submit failed:', error)
    } finally {
      setSubmitting(false)
    }
  })

  const resetForm = useCallback((): void => {
    form.reset({ holeId: generateHoleId(), kind: 'diamond', depth: '', sampleTag: '' })
    setLayers([])
    setDraft(EMPTY_DRAFT)
    setSubmitted(null)
  }, [form])

  if (submitted) {
    return (
      <View>
        <Section title={t.common.saved}>
          <ConfirmationCard
            title={t.drillHole.confirmTitle}
            message={t.drillHole.confirmMessage}
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
          insideLabel={t.drillHole.fenceInside}
          outsideLabel={t.drillHole.fenceOutside}
          capturingLabel={t.drillHole.gpsCapturing}
          latLngLabel={t.drillHole.gpsLatLng}
          accuracyLabel={t.drillHole.gpsAccuracy}
          distanceLabel={t.drillHole.fenceDistance}
          noGpsLabel={t.drillHole.fenceNoGps}
        />
        <Button
          label={t.drillHole.gpsCapture}
          variant="ghost"
          onPress={() => void location.capture()}
        />
      </Section>
      <DrillHoleFields control={form.control} setValue={form.setValue} t={t} />
      <Section title={t.drillHole.layers} hint={t.drillHole.layersHint}>
        <LayerList
          layers={layers}
          draft={draft}
          onChangeDraft={setDraft}
          onAdd={addLayer}
          onRemove={removeLayer}
          addLabel={t.drillHole.addLayer}
          removeLabel={t.common.cancel}
          typeLabel={t.drillHole.layerType}
          fromLabel={t.drillHole.layerFrom}
          toLabel={t.drillHole.layerTo}
          emptyLabel={t.common.empty}
        />
      </Section>
      <View style={styles.actions}>
        <Button
          label={submitting ? t.common.submitting : t.common.submit}
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
