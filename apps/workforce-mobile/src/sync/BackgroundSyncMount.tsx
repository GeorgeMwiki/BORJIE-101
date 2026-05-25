import { useBackgroundSync } from './useBackgroundSync'

/**
 * Headless component that lives inside the React tree to call the background
 * sync hook. Hooks can only run inside React components, so this wrapper
 * exists for the root layout to mount once.
 */
export function BackgroundSyncMount(): null {
  useBackgroundSync()
  return null
}
