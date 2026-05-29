/**
 * WorkerHomeHero — data-loading wrapper around WorkerHeroCard.
 *
 * Roadmap R5. Reads `/api/v1/field/workforce/me` (worker identity +
 * shift) and `/api/v1/field/workforce/tasks/next` (next assigned task)
 * and feeds the presentational `WorkerHeroCard`. The wrapper is
 * intentionally tiny:
 *   • Holds no derived state beyond the API payload.
 *   • Tolerates a missing endpoint gracefully — when fetch returns null,
 *     the card renders the "no shift" + "no next task" state from the
 *     locally cached user.
 *   • Surfaces mark-complete + need-help intents to the brain via the
 *     same micro-action contract the chat uses.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { useI18n } from '../i18n/useI18n'
import { request } from '../api/client'
import { FIELD_PREFIX } from '../api/config'
import { WorkerHeroCard } from './WorkerHeroCard'
import {
  buildHeroData,
  type MeResponseShape,
  type NextTaskResponseShape,
} from './worker-hero-card.helpers'

export { buildHeroData } from './worker-hero-card.helpers'

export function WorkerHomeHero(): JSX.Element | null {
  const { user } = useAuth()
  const { lang } = useI18n()
  const [me, setMe] = useState<MeResponseShape | null>(null)
  const [task, setTask] = useState<NextTaskResponseShape | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const next = await request<MeResponseShape>(
          `${FIELD_PREFIX}/workforce/me`,
        )
        if (!cancelled) setMe(next)
      } catch {
        // Endpoint may be optional in dev — leave `me` as null so the
        // card falls back to the cached user identity.
      }
      try {
        const t = await request<NextTaskResponseShape>(
          `${FIELD_PREFIX}/workforce/tasks/next`,
        )
        if (!cancelled) setTask(t)
      } catch {
        if (!cancelled) setTask(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const fallbackName =
    user?.fullName ?? (lang === 'sw' ? 'Mfanyakazi' : 'Worker')

  const onMarkComplete = useCallback(
    async (taskId: string): Promise<void> => {
      try {
        await request<{ readonly ok: true }>(
          `${FIELD_PREFIX}/workforce/tasks/${encodeURIComponent(taskId)}/complete`,
          { method: 'POST' },
        )
        setTask(null)
      } catch {
        // Surface failures via the chat; the hero stays unchanged.
      }
    },
    [],
  )

  const onNeedHelp = useCallback(
    async (taskId: string | null): Promise<void> => {
      try {
        await request<{ readonly ok: true }>(
          `${FIELD_PREFIX}/workforce/help-requests`,
          {
            method: 'POST',
            body: { taskId, locale: lang },
          },
        )
      } catch {
        // best-effort
      }
    },
    [lang],
  )

  const data = buildHeroData(me, task, fallbackName, lang)
  return (
    <WorkerHeroCard
      data={data}
      locale={lang}
      onMarkComplete={onMarkComplete}
      onNeedHelp={onNeedHelp}
    />
  )
}
