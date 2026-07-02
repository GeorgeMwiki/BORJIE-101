import { useCallback, useEffect, useState } from 'react'
import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList, type PlaceholderItem } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useQueueSize } from '../../src/sync/useQueueSize'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'
import { listQueued, subscribeQueue, type QueuedWrite } from '../../src/sync/queue'
import { useI18n } from '../../src/i18n/useI18n'
import { formatDateTime } from '../../src/home/owner/format'

const SCREEN_ID = 'W-M-21'

/**
 * Upload-queue surface. Renders the REAL offline write queue (the same
 * `listQueued()` sink `enqueueWrite` feeds) so a worker on a flaky mine
 * network sees exactly what is still waiting to sync, how many attempts
 * each has had, and the last error — live via the queue pub/sub, no
 * placeholder. All copy flows through the active-locale i18n bundle; the
 * queued time renders through the active-locale formatter, never the host
 * device locale.
 */
export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <SyncQueueBody />
      </ScreenShell>
    </RoleGuard>
  )
}

function SyncQueueBody(): JSX.Element {
  const { t, lang } = useI18n()
  const copy = t.workerScreens
  const queueSize = useQueueSize()
  const { online } = useOnlineStatus()
  const [entries, setEntries] = useState<ReadonlyArray<QueuedWrite>>([])

  const refresh = useCallback(async (): Promise<void> => {
    const next = await listQueued()
    setEntries(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void listQueued().then((next) => {
      if (!cancelled) setEntries(next)
    })
    // Re-read the full list whenever the queue size changes (enqueue / drain).
    const unsubscribe = subscribeQueue(() => {
      void refresh()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [refresh])

  const entityLabel = (entityType: QueuedWrite['entityType']): string =>
    copy.entityType[entityType] ?? entityType

  const items: ReadonlyArray<PlaceholderItem> = entries.map((entry) => {
    const attempts = copy.syncQueueAttempts.replace('{{count}}', String(entry.attempts))
    const queuedAt = `${copy.syncQueueQueuedAt} ${formatDateTime(
      new Date(entry.enqueuedAt).toISOString(),
      lang
    )}`
    const lastError = entry.lastError
      ? ` · ${copy.syncQueueLastError.replace('{{error}}', entry.lastError)}`
      : ''
    return {
      id: entry.id,
      primary: entityLabel(entry.entityType),
      secondary: `${queuedAt} · ${attempts}${lastError}`
    }
  })

  return (
    <>
      <Section title={copy.syncQueueTitle}>
        <BigNumber
          value={String(queueSize)}
          label={copy.syncQueuePending}
          caption={online ? copy.syncQueueOnline : copy.syncQueueOffline}
        />
      </Section>
      <Section title={copy.syncQueueTitle}>
        <PlaceholderList items={items} emptyLabel={copy.syncQueueEmpty} />
      </Section>
    </>
  )
}
