import { useEffect, useState } from 'react'
import { getQueueSize } from './queue'

/**
 * Polls the sync queue size every 4s. Lightweight enough for the offline
 * banner; replace with an event emitter when the flush worker lands.
 */
export function useQueueSize(): number {
  const [size, setSize] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    async function tick(): Promise<void> {
      const next = await getQueueSize()
      if (!cancelled) {
        setSize(next)
      }
    }
    void tick()
    const handle = setInterval(() => {
      void tick()
    }, 4000)
    return () => {
      cancelled = true
      clearInterval(handle)
    }
  }, [])

  return size
}
