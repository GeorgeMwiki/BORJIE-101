import { useEffect, useState } from 'react'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'

export interface OnlineStatus {
  online: boolean
  ready: boolean
}

/**
 * Subscribe to OS-level connectivity. Defaults to assuming online until the
 * first event arrives — pessimistic UX is worse than briefly optimistic UX
 * for field workers on flaky networks.
 */
export function useOnlineStatus(): OnlineStatus {
  const [state, setState] = useState<OnlineStatus>({ online: true, ready: false })

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((info: NetInfoState) => {
      const online = info.isConnected !== false && info.isInternetReachable !== false
      setState({ online, ready: true })
    })
    return () => {
      unsubscribe()
    }
  }, [])

  return state
}
