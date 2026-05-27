import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { RoleGuard } from '../../src/components/RoleGuard'
import { Button } from '../../src/forms/Button'
import { PreviewBanner } from '../../src/components/PreviewBanner'
import { miningApi } from '../../src/api/client'
import { ApiError } from '../../src/api/errors'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { useAuth } from '../../src/auth/useAuth'
import { enqueueWrite } from '../../src/sync/queue'
import { colors } from '../../src/theme/colors'
import { fontSize, radius, spacing } from '../../src/theme/spacing'

const SCREEN_ID = 'W-M-08'

const COPY = {
  loading: 'Inapakia sampuli... · Loading samples...',
  empty: 'Hakuna sampuli leo. · No samples today.',
  errorPrefix: 'Hitilafu: ',
  sealOk: 'Sampuli imehifadhiwa kwenye seva.',
  sealQueued: 'Sampuli imehifadhiwa offline.'
} as const

interface Attributes {
  readonly chain?: ReadonlyArray<{ actor?: string; role?: string; atISO?: string }>
}

interface Sample {
  readonly id: string
  readonly sampleTag: string | null
  readonly massG: string | null
  readonly attributes: Attributes
  readonly createdAt: string
  readonly passedQaqc: boolean | null
}

interface ListResponse {
  readonly success: true
  readonly data: ReadonlyArray<Sample>
}

interface CreateSampleInput {
  readonly sampleTag: string
  readonly massG?: string
  readonly attributes?: Record<string, unknown>
}

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SampleView />
      </ScreenShell>
    </RoleGuard>
  )
}

function SampleView(): JSX.Element {
  const { user } = useAuth()
  const { online } = useOnlineStatus()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => [SCREEN_ID, 'samples', user?.tenantId ?? ''], [user?.tenantId])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'idle' | 'ok' | 'queued'>('idle')

  const query = useQuery<ListResponse, ApiError>({
    queryKey,
    queryFn: () => miningApi.get<ListResponse>('/samples', { query: { limit: 50 } }),
    enabled: Boolean(user)
  })

  const sealMutation = useMutation<Sample, ApiError, CreateSampleInput>({
    mutationFn: async (input) => {
      const resp = await miningApi.post<{ success: true; data: Sample }>('/samples', input)
      return resp.data
    },
    onSuccess: () => {
      setConfirmation('ok')
      queryClient.invalidateQueries({ queryKey })
    },
    onError: async (error, input) => {
      if (error.status === 0 || !online) {
        await enqueueWrite('sample', input)
        setConfirmation('queued')
      }
    }
  })

  const onSelect = useCallback((id: string): void => {
    setActiveId(id)
  }, [])

  const onSeal = useCallback((): void => {
    if (!activeId) return
    const target = query.data?.data.find((s) => s.id === activeId)
    if (!target) return
    const payload: CreateSampleInput = target.massG
      ? {
          sampleTag: `${target.sampleTag ?? 'SMP'}-SEAL-${Date.now().toString().slice(-6)}`,
          massG: target.massG,
          attributes: {
            sealedFrom: target.id,
            sealedAtIso: new Date().toISOString(),
            source: 'W-M-08'
          }
        }
      : {
          sampleTag: `${target.sampleTag ?? 'SMP'}-SEAL-${Date.now().toString().slice(-6)}`,
          attributes: {
            sealedFrom: target.id,
            sealedAtIso: new Date().toISOString(),
            source: 'W-M-08'
          }
        }
    sealMutation.mutate(payload)
  }, [activeId, query.data, sealMutation])

  const samples = query.data?.data ?? []
  const active = useMemo(() => samples.find((s) => s.id === activeId) ?? null, [samples, activeId])
  const networkError = query.error?.status === 0 || query.error?.status === 503

  return (
    <View>
      {query.isLoading ? (
        <Section title="Sampuli za leo">
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.gold} />
            <Text style={styles.muted}>{COPY.loading}</Text>
          </View>
        </Section>
      ) : null}
      {query.error && networkError ? (
        <Section title="Sampuli za leo">
          <PreviewBanner kind="env-missing" />
        </Section>
      ) : null}
      {query.error && !networkError ? (
        <Section title="Sampuli za leo">
          <Text style={styles.errorText}>{COPY.errorPrefix}{query.error.message}</Text>
        </Section>
      ) : null}
      {!query.isLoading && !query.error && samples.length === 0 ? (
        <Section title="Sampuli za leo">
          <PreviewBanner kind="no-data" />
          <Text style={styles.muted}>{COPY.empty}</Text>
        </Section>
      ) : null}
      {samples.length > 0 ? (
        <Section title={`Sampuli za leo (${samples.length})`}>
          {samples.map((s) => {
            const selected = s.id === activeId
            return (
              <Pressable
                key={s.id}
                accessibilityRole="button"
                accessibilityLabel={`Chagua sampuli ${s.sampleTag ?? s.id.slice(0, 8)}`}
                accessibilityState={{ selected }}
                onPress={() => onSelect(s.id)}
                style={({ pressed }) => [
                  styles.sampleRow,
                  selected && styles.sampleRowSelected,
                  pressed && styles.sampleRowPressed
                ]}
              >
                <View style={styles.qr}>
                  <Text style={styles.qrText}>QR</Text>
                </View>
                <View style={styles.sampleBody}>
                  <Text style={styles.sampleTag}>{s.sampleTag ?? s.id.slice(0, 8)}</Text>
                  <Text style={styles.sampleMeta}>
                    Uzito: {formatMassKg(s.massG)} · {countChain(s)} mikono
                  </Text>
                </View>
                {s.passedQaqc === true ? (
                  <View style={styles.sealedBadge}>
                    <Text style={styles.sealedBadgeText}>IMEPITISHWA</Text>
                  </View>
                ) : null}
              </Pressable>
            )
          })}
        </Section>
      ) : null}
      {active ? (
        <Section
          title={`Mlolongo wa udhibiti — ${active.sampleTag ?? active.id.slice(0, 8)}`}
          hint="Nani alishika sampuli na lini"
        >
          {(active.attributes?.chain ?? []).length === 0 ? (
            <Text style={styles.muted}>Hakuna mlolongo umewekwa bado.</Text>
          ) : (
            (active.attributes?.chain ?? []).map((step, idx) => (
              <View key={`${active.id}-chain-${idx}`} style={styles.chainRow}>
                <View style={styles.chainDot}>
                  <Text style={styles.chainDotText}>{idx + 1}</Text>
                </View>
                <View style={styles.chainBody}>
                  <Text style={styles.chainActor}>{step.actor ?? '—'}</Text>
                  <Text style={styles.chainMeta}>
                    {step.role ?? ''} · {step.atISO ? formatHM(step.atISO) : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Section>
      ) : null}
      {active ? (
        <Section title="Funga sampuli">
          {sealMutation.isPending ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.gold} />
              <Text style={styles.muted}>{COPY.loading}</Text>
            </View>
          ) : (
            <Button
              label="Funga Sampuli"
              onPress={onSeal}
              disabled={confirmation === 'ok'}
            />
          )}
          {confirmation === 'ok' ? (
            <Text style={styles.successText}>{COPY.sealOk}</Text>
          ) : null}
          {confirmation === 'queued' ? (
            <Text style={styles.warnText}>{COPY.sealQueued}</Text>
          ) : null}
          {sealMutation.error && sealMutation.error.status !== 0 && sealMutation.error.status !== 503 ? (
            <Text style={styles.errorText}>{COPY.errorPrefix}{sealMutation.error.message}</Text>
          ) : null}
        </Section>
      ) : null}
      {!online ? <PreviewBanner kind="offline" /> : null}
    </View>
  )
}

function countChain(s: Sample): number {
  return (s.attributes?.chain ?? []).length
}

function formatMassKg(massG: string | null): string {
  if (!massG) return '—'
  const grams = Number(massG)
  if (!Number.isFinite(grams)) return massG
  return `${(grams / 1000).toFixed(1)} kg`
}

function formatHM(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const styles = StyleSheet.create({
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md
  },
  sampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  sampleRowSelected: {
    borderWidth: 2,
    borderColor: colors.gold
  },
  sampleRowPressed: {
    backgroundColor: colors.earth100
  },
  qr: {
    width: 56,
    height: 56,
    backgroundColor: colors.earth900,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm
  },
  qrText: {
    color: colors.goldLight,
    fontSize: fontSize.lead,
    fontWeight: '800'
  },
  sampleBody: {
    flex: 1
  },
  sampleTag: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '700'
  },
  sampleMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  sealedBadge: {
    backgroundColor: colors.success,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm
  },
  sealedBadgeText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: '800',
    letterSpacing: 1
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    gap: spacing.md
  },
  chainDot: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chainDotText: {
    color: colors.earth900,
    fontWeight: '800',
    fontSize: fontSize.body
  },
  chainBody: {
    flex: 1
  },
  chainActor: {
    color: colors.text,
    fontSize: fontSize.lead,
    fontWeight: '600'
  },
  chainMeta: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    marginTop: spacing.xs
  },
  successText: {
    color: colors.success,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  },
  warnText: {
    color: colors.warn,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
    fontWeight: '600'
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.body,
    marginTop: spacing.sm
  }
})
