import { useEffect, useState } from 'react'
import { getQueueSize, subscribeQueue } from './queue'

/**
 * Live queue size. Uses the queue's pub/sub for synchronous updates on
 * enqueue/remove, plus an initial fetch for the first paint.
 */
export function useQueueSize(): number {
  const [size, setSize] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    void getQueueSize().then((next) => {
      if (!cancelled) {
        setSize(next)
      }
    })
    const unsubscribe = subscribeQueue((next) => {
      setSize(next)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return size
}
