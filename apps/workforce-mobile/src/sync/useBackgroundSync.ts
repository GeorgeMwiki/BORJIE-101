import { useEffect, useRef } from 'react'
import { useOnlineStatus } from '../offline/useOnlineStatus'
import { useQueueSize } from './useQueueSize'
import { flushQueue } from './flush'

const FLUSH_INTERVAL_MS = 60_000

/**
 * Drain the offline queue whenever the device is online and has pending
 * writes. Fires immediately on the online↔offline transition, then every
 * 60s as a safety net while online. Uses a ref so we never trigger
 * concurrent flushes from the same screen.
 */
export function useBackgroundSync(): void {
  const { online, ready } = useOnlineStatus()
  const queueSize = useQueueSize()
  const flushingRef = useRef<boolean>(false)

  useEffect(() => {
    if (!ready || !online || queueSize === 0) {
      return
    }
    let cancelled = false
    async function run(): Promise<void> {
      if (flushingRef.current) {
        return
      }
      flushingRef.current = true
      try {
        await flushQueue()
      } catch (error) {
        console.error('Background flush failed:', error)
      } finally {
        if (!cancelled) {
          flushingRef.current = false
        }
      }
    }
    void run()
    const handle = setInterval(() => {
      void run()
    }, FLUSH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [online, ready, queueSize])
}
