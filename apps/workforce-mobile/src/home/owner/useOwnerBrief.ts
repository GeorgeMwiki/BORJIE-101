import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'
import { miningApi } from '../../api/client'
import { ApiError } from '../../api/errors'
import { classifyDelta, severityRank } from './format'
import { MAX_DECISIONS, type DecisionItem, type OwnerBrief, type PillarStatus } from './types'

/**
 * Tries the unified `/v1/owner/brief` endpoint first (one round-trip).
 * If it is missing (404 / 501 / 0-network on that path), composes the
 * same shape from the 6 existing mining cockpit + incidents endpoints
 * in parallel. The composed result is sorted + truncated to the spec's
 * MAX_DECISIONS cap on the client so AlertQueue is fed a clean list.
 */
export function useOwnerBrief(): UseQueryResult<OwnerBrief, Error> {
  return useQuery<OwnerBrief, Error>({
    queryKey: ['owner-brief'],
    queryFn: async ({ signal }) => {
      try {
        const unified = await miningApi.get<unknown>('/owner/brief', { signal })
        const parsed = OwnerBriefSchema.safeParse(unified)
        if (parsed.success) {
          return capDecisions(parsed.data as OwnerBrief)
        }
      } catch (error) {
        if (!shouldFallback(error)) {
          throw error
        }
      }
      return capDecisions(await composeFallback(signal))
    },
    staleTime: 60_000,
    retry: 1
  })
}

function shouldFallback(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false
  }
  return error.status === 0 || error.status === 404 || error.status === 501
}

function capDecisions(brief: OwnerBrief): OwnerBrief {
  const sorted = [...brief.needsReview].sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity)
  )
  return {
    ...brief,
    needsReview: sorted.slice(0, MAX_DECISIONS)
  }
}

async function composeFallback(signal: AbortSignal | undefined): Promise<OwnerBrief> {
  const [
    dailyBrief,
    productionVsTarget,
    cashRunway,
    cliffStatus,
    incidentsHigh,
    licenceHealth
  ] = await Promise.all([
    safeGet<unknown>('/cockpit/daily-brief', signal),
    safeGet<unknown>('/cockpit/production-vs-target', signal),
    safeGet<unknown>('/cockpit/cash-runway', signal),
    safeGet<unknown>('/cockpit/27mar-cliff-status', signal),
    safeGet<unknown>('/incidents?status=open&severity=high', signal),
    safeGet<unknown>('/cockpit/licence-health', signal)
  ])
  return buildBriefFromParts(
    dailyBrief,
    productionVsTarget,
    cashRunway,
    cliffStatus,
    incidentsHigh,
    licenceHealth
  )
}

async function safeGet<T>(path: string, signal: AbortSignal | undefined): Promise<T | null> {
  try {
    return await miningApi.get<T>(path, signal ? { signal } : {})
  } catch (error) {
    if (error instanceof ApiError && (error.status === 0 || error.status === 404)) {
      return null
    }
    throw error
  }
}

interface EnvelopedData<T> {
  readonly success: boolean
  readonly data: T
}

function unwrap<T>(value: unknown): T | null {
  if (value === null || value === undefined || typeof value !== 'object') {
    return null
  }
  const enveloped = value as EnvelopedData<T>
  if (typeof enveloped.success === 'boolean' && enveloped.data !== undefined) {
    return enveloped.data
  }
  return value as T
}

function buildBriefFromParts(
  rawDailyBrief: unknown,
  rawProduction: unknown,
  rawCash: unknown,
  rawCliff: unknown,
  rawIncidents: unknown,
  rawLicences: unknown
): OwnerBrief {
  const daily = unwrap<DailyBriefData>(rawDailyBrief)
  const prod = unwrap<ProductionData>(rawProduction)
  const cash = unwrap<CashData>(rawCash)
  const cliff = unwrap<CliffData>(rawCliff)
  const incidents = unwrap<ReadonlyArray<IncidentRow>>(rawIncidents) ?? []
  const licences = unwrap<ReadonlyArray<LicenceRow>>(rawLicences) ?? []

  const generatedAtIso = new Date().toISOString()
  const productionTonnes = (prod?.perSite ?? []).reduce(
    (sum, row) => sum + (Number.isFinite(row.tonnes) ? (row.tonnes ?? 0) : 0),
    0
  )
  const productionTarget = (prod?.perSite ?? []).reduce(
    (sum, row) => sum + (Number.isFinite(row.target) ? (row.target ?? 0) : 0),
    0
  )
  const productionDelta = productionTarget > 0
    ? ((productionTonnes - productionTarget) / productionTarget) * 100
    : 0
  const ninetyDayNet = cash?.ninetyDayNetTzs ?? 0
  const dailyAvg = cash?.dailyAvgTzs ?? 0
  const daysRemaining = dailyAvg > 0 ? Math.floor(ninetyDayNet / dailyAvg) : 0
  const cliffActive = cliff?.remediationComplete === false
  const usdExposureTzs = (cliff?.usdDenominated ?? 0) * dailyAvg
  const openHigh = (incidents ?? []).length
  const safetyLicenceStatus: PillarStatus = (licences ?? []).some(
    (l) => (l.daysToExpiry ?? 999) <= 30
  )
    ? 'danger'
    : (licences ?? []).some((l) => (l.daysToExpiry ?? 999) <= 90)
      ? 'warn'
      : 'ok'

  return {
    briefId: `composed-${generatedAtIso}`,
    generatedAtIso,
    swText: buildSummarySw(daily, productionTonnes, openHigh, daysRemaining),
    enText: buildSummaryEn(daily, productionTonnes, openHigh, daysRemaining),
    evidenceIds: [],
    needsReview: composeDecisions(incidents, licences),
    production: {
      currentTonnes: productionTonnes,
      targetTonnes: productionTarget,
      deltaPct: productionDelta,
      status: classifyDelta(productionDelta),
      sparkline7d: [],
      perSite: (prod?.perSite ?? []).map((row) => ({
        siteId: row.siteId ?? 'unknown',
        siteName: row.siteName ?? row.siteId ?? 'Site',
        tonnes: Number(row.tonnes ?? 0),
        target: Number(row.target ?? 0)
      }))
    },
    cash: {
      currentTzs: ninetyDayNet,
      deltaPct: 0,
      status: cliffActive ? 'danger' : classifyDelta(0),
      sparkline7d: [],
      daysRemaining,
      usdCliffActive: cliffActive,
      usdExposureTzs
    },
    safety: {
      openHighCount: openHigh,
      licencesStatus: safetyLicenceStatus,
      licenceLabelSw: safetyLicenceStatus === 'ok' ? 'Leseni salama' : 'Leseni karibu kumalizika',
      licenceLabelEn: safetyLicenceStatus === 'ok' ? 'Licences OK' : 'Licences near expiry',
      sparkline7d: []
    }
  }
}

function composeDecisions(
  incidents: ReadonlyArray<IncidentRow>,
  licences: ReadonlyArray<LicenceRow>
): ReadonlyArray<DecisionItem> {
  const incidentItems: ReadonlyArray<DecisionItem> = incidents.slice(0, MAX_DECISIONS).map(
    (row): DecisionItem => ({
      id: `incident:${row.id ?? row.siteId ?? 'open'}`,
      severity: 'high',
      titleSw: `Tukio la usalama · ${row.siteId ?? 'Mgodi'}`,
      titleEn: `Safety incident · ${row.siteId ?? 'Site'}`,
      kind: 'incident',
      primaryActionUrl: '/incidents'
    })
  )
  const licenceItems: ReadonlyArray<DecisionItem> = licences
    .filter((l) => (l.daysToExpiry ?? 999) <= 90)
    .slice(0, MAX_DECISIONS)
    .map(
      (row): DecisionItem => ({
        id: `licence:${row.id ?? row.licenceNumber ?? 'pml'}`,
        severity: (row.daysToExpiry ?? 999) <= 30 ? 'high' : 'amber',
        titleSw: `Leseni ${row.licenceNumber ?? ''} inakwisha siku ${row.daysToExpiry ?? '—'}`,
        titleEn: `Licence ${row.licenceNumber ?? ''} expires in ${row.daysToExpiry ?? '—'} days`,
        kind: 'licence',
        primaryActionUrl: '/licences'
      })
    )
  return [...incidentItems, ...licenceItems]
}

function buildSummarySw(
  daily: DailyBriefData | null,
  tonnes: number,
  openHigh: number,
  daysRemaining: number
): string {
  if (!daily) {
    return 'Brief haijapatikana bado. Hakikisha mtandao na jaribu tena.'
  }
  return `Leo: shifti ${daily.shiftsToday ?? 0}, tani ${tonnes.toFixed(0)}, matukio ${openHigh}, siku za pesa ${daysRemaining}.`
}

function buildSummaryEn(
  daily: DailyBriefData | null,
  tonnes: number,
  openHigh: number,
  daysRemaining: number
): string {
  if (!daily) {
    return 'Brief not available yet. Check connectivity and try again.'
  }
  return `Today: ${daily.shiftsToday ?? 0} shifts, ${tonnes.toFixed(0)}t produced, ${openHigh} high-severity incidents, ${daysRemaining} cash days.`
}

interface DailyBriefData {
  readonly date?: string
  readonly shiftsToday?: number
  readonly openIncidents?: number
  readonly openGrievances?: number
  readonly criticalIncidents?: number
}

interface ProductionData {
  readonly window?: string
  readonly perSite?: ReadonlyArray<{
    readonly siteId?: string
    readonly siteName?: string
    readonly tonnes?: number
    readonly target?: number
  }>
}

interface CashData {
  readonly ninetyDayNetTzs?: number
  readonly dailyAvgTzs?: number
  readonly sampleCount?: number
}

interface CliffData {
  readonly cliffDateIso?: string
  readonly postCliffSales?: number
  readonly usdDenominated?: number
  readonly remediationComplete?: boolean
}

interface IncidentRow {
  readonly id?: string
  readonly siteId?: string
  readonly severity?: string
  readonly status?: string
}

interface LicenceRow {
  readonly id?: string
  readonly licenceNumber?: string
  readonly daysToExpiry?: number | null
}

const DecisionItemSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['high', 'amber', 'info']),
  titleSw: z.string().min(1),
  titleEn: z.string().min(1),
  kind: z.enum(['incident', 'licence', 'sale', 'billing', 'report', 'other']),
  primaryActionUrl: z.string().min(1),
  secondaryActionUrl: z.string().optional()
})

const PillarStatusSchema = z.enum(['ok', 'warn', 'danger'])

const OwnerBriefSchema = z.object({
  briefId: z.string().min(1),
  generatedAtIso: z.string().min(1),
  swText: z.string().min(1),
  enText: z.string().min(1),
  evidenceIds: z.array(z.string()).readonly(),
  needsReview: z.array(DecisionItemSchema).readonly(),
  production: z.object({
    currentTonnes: z.number(),
    targetTonnes: z.number(),
    deltaPct: z.number(),
    status: PillarStatusSchema,
    sparkline7d: z.array(z.number()).readonly(),
    perSite: z.array(z.object({
      siteId: z.string(),
      siteName: z.string(),
      tonnes: z.number(),
      target: z.number()
    })).readonly()
  }),
  cash: z.object({
    currentTzs: z.number(),
    deltaPct: z.number(),
    status: PillarStatusSchema,
    sparkline7d: z.array(z.number()).readonly(),
    daysRemaining: z.number(),
    usdCliffActive: z.boolean(),
    usdExposureTzs: z.number()
  }),
  safety: z.object({
    openHighCount: z.number(),
    licencesStatus: PillarStatusSchema,
    licenceLabelSw: z.string(),
    licenceLabelEn: z.string(),
    sparkline7d: z.array(z.number()).readonly()
  })
})

export { capDecisions, buildBriefFromParts }
