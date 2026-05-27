/**
 * ToolCallRenderer — routes a brain tool-call name to the matching
 * surface card. The mapping is a single switch so it stays grep-able
 * and side-effect free; adding a new tool means: (a) extend
 * `TOOL_CARD_ROUTING`, (b) add a wrapper component if the source
 * card needs query-hook plumbing, (c) update the tests.
 *
 * Why the wrappers? The home cards in src/home/{owner,manager,employee}
 * fall into two patterns:
 *   - Self-fetching cards (CrewRoster, ExceptionStack, SitePulse) take
 *     a siteId and call mining-API queries internally. We pass null so
 *     the api-gateway picks the actor's bound site.
 *   - Data-prop cards (AiDailyBrief, AlertQueue, ProductionVsTarget,
 *     TodayTasks, ShiftStatusHero, PerformanceSnapshot) require their
 *     payload from a parent. We wrap each with the canonical query hook
 *     so the chat surface remains layout-only.
 *
 * Fallback: any unrecognised tool name renders a <CodeBlock> with the
 * raw JSON so the brain can't silently swallow a payload.
 */
import { StyleSheet, Text, View } from 'react-native'
import { useOnlineStatus } from '../offline/useOnlineStatus'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import { colors } from '../theme/colors'
import { fontSize, radius, spacing } from '../theme/spacing'
import { AiDailyBrief } from '../home/owner/AiDailyBrief'
import { AlertQueue } from '../home/owner/AlertQueue'
import { ProductionVsTarget } from '../home/owner/ProductionVsTarget'
import { useOwnerBrief } from '../home/owner/useOwnerBrief'
import { CrewRoster } from '../home/manager/CrewRoster'
import { ExceptionStack } from '../home/manager/ExceptionStack'
import { TodayTasks } from '../home/employee/TodayTasks'
import { ShiftStatusHero } from '../home/employee/ShiftStatusHero'
import { PerformanceSnapshot } from '../home/employee/PerformanceSnapshot'
import {
  useTodayShift,
  useTodayTasks,
  usePerformanceSnapshot
} from '../home/employee/queries'
import { pickLabel } from './homeChatCopy'
import { TOOL_CARD_ROUTING, isKnownTool, type ToolName } from './toolCardRouting'
import type { ToolCallResult } from './types'

export interface ToolCallRendererProps {
  readonly call: ToolCallResult
}

// Re-export the routing table so existing imports (`from '../chat/ToolCallRenderer'`)
// keep compiling without forcing every consumer to switch path.
export { TOOL_CARD_ROUTING, isKnownTool }
export type { ToolName }

export function ToolCallRenderer({ call }: ToolCallRendererProps): JSX.Element {
  const { lang } = useI18n()
  if (!isKnownTool(call.tool)) {
    return <UnknownToolCard call={call} />
  }
  const headerLabel = TOOL_CARD_ROUTING[call.tool][lang]
  const body = renderKnown(call.tool)
  return (
    <View style={styles.cardWrap} testID={`home-chat-tool-card-${call.tool}`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardBadge}>{pickLabel('toolCardHeader', lang)}</Text>
        <Text style={styles.cardTitle}>{headerLabel}</Text>
      </View>
      <View style={styles.cardBody}>{body}</View>
    </View>
  )
}

function renderKnown(tool: ToolName): JSX.Element {
  switch (tool) {
    case 'cockpit.daily-brief':
      return <OwnerBriefCard slot="brief" />
    case 'cockpit.decisions':
      return <OwnerBriefCard slot="decisions" />
    case 'cockpit.production':
      return <OwnerBriefCard slot="production" />
    case 'attendance.crew':
      return <CrewRoster siteId={null} />
    case 'incidents.exceptions':
      return <ExceptionStack siteId={null} />
    case 'tasks.today':
      return <TodayTasksCard />
    case 'attendance.shift':
      return <ShiftStatusCard />
    case 'performance.snapshot':
      return <PerformanceSnapshotCard />
  }
}

// ─────────────────────────────────────────────────────────────────────
// Owner wrappers — share the unified owner-brief query so we only fire
// one round-trip per chat surface mount no matter how many of the three
// owner cards the brain emits.
// ─────────────────────────────────────────────────────────────────────

interface OwnerSlotProps {
  readonly slot: 'brief' | 'decisions' | 'production'
}

function OwnerBriefCard({ slot }: OwnerSlotProps): JSX.Element {
  const { lang } = useI18n()
  const query = useOwnerBrief()
  if (query.isLoading) {
    return <LoadingLine lang={lang} />
  }
  if (query.isError || !query.data) {
    return <ErrorLine lang={lang} />
  }
  if (slot === 'brief') {
    return <AiDailyBrief brief={query.data} lang={lang} />
  }
  if (slot === 'decisions') {
    return <AlertQueue items={query.data.needsReview} lang={lang} />
  }
  return <ProductionVsTarget production={query.data.production} lang={lang} />
}

// ─────────────────────────────────────────────────────────────────────
// Employee wrappers — bind each card to its dedicated query hook so the
// payload arrives via the same wire path the W-M-02 worker home uses.
// ─────────────────────────────────────────────────────────────────────

function TodayTasksCard(): JSX.Element {
  const { user } = useAuth()
  const { lang } = useI18n()
  const userId = user?.id ?? null
  const query = useTodayTasks(userId)
  return (
    <TodayTasks
      tasks={query.data}
      loading={query.isLoading}
      error={query.error ?? null}
      userId={userId}
      lang={lang}
    />
  )
}

function ShiftStatusCard(): JSX.Element {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const { online } = useOnlineStatus()
  const query = useTodayShift(userId)
  return (
    <ShiftStatusHero
      shift={query.data}
      loading={query.isLoading}
      error={query.error ?? null}
      online={online}
      userId={userId}
    />
  )
}

function PerformanceSnapshotCard(): JSX.Element {
  const { user } = useAuth()
  const { lang } = useI18n()
  const userId = user?.id ?? null
  const query = usePerformanceSnapshot(userId)
  return (
    <PerformanceSnapshot
      data={query.data}
      loading={query.isLoading}
      error={query.error ?? null}
      lang={lang}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────
// Fallback — show the raw payload as a code block so the brain cannot
// silently emit a tool the UI does not know how to render.
// ─────────────────────────────────────────────────────────────────────

function UnknownToolCard({ call }: { readonly call: ToolCallResult }): JSX.Element {
  const { lang } = useI18n()
  const json = JSON.stringify(call, null, 2)
  return (
    <View style={styles.cardWrap} testID={`home-chat-tool-card-unknown`}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardBadge}>{pickLabel('toolCardHeader', lang)}</Text>
        <Text style={styles.cardTitle}>{call.tool}</Text>
      </View>
      <View style={styles.codeWrap}>
        <Text style={styles.codeText}>{json}</Text>
      </View>
    </View>
  )
}

function LoadingLine({ lang }: { readonly lang: 'sw' | 'en' }): JSX.Element {
  return <Text style={styles.muted}>{pickLabel('thinking', lang)}</Text>
}

function ErrorLine({ lang }: { readonly lang: 'sw' | 'en' }): JSX.Element {
  return <Text style={styles.errorMuted}>{pickLabel('errorRetry', lang)}</Text>
}

const styles = StyleSheet.create({
  cardWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm
  },
  cardHeader: {
    marginBottom: spacing.sm
  },
  cardBadge: {
    color: colors.goldDark,
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase'
  },
  cardTitle: {
    color: colors.earth900,
    fontSize: fontSize.h3,
    fontWeight: '700',
    marginTop: spacing.xs
  },
  cardBody: {
    marginTop: spacing.xs
  },
  codeWrap: {
    backgroundColor: colors.earth900,
    borderRadius: radius.sm,
    padding: spacing.md
  },
  codeText: {
    color: colors.surface,
    fontSize: fontSize.caption,
    fontFamily: 'Menlo'
  },
  muted: {
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontStyle: 'italic'
  },
  errorMuted: {
    color: colors.danger,
    fontSize: fontSize.body
  }
})
