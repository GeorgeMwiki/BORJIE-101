import { ScreenShell } from '../../src/components/ScreenShell'
import { HomeChat } from '../../src/chat/HomeChat'
import { useAuth } from '../../src/auth/useAuth'

/**
 * Ask tab — same live brain surface as the Home tab. Renders `HomeChat`,
 * which streams against POST /api/v1/brain/turn (`streamBrainTurn`). The
 * previous divergent stack (`useChat` → `streamChat` → /api/v1/mining/chat)
 * has been retired so there is one real chat path across the app.
 */
export default function AskTab(): JSX.Element {
  const { user } = useAuth()
  const screenId = user?.role === 'owner' ? 'O-M-02' : 'W-M-16'
  return (
    <ScreenShell screenId={screenId} scroll={false}>
      <HomeChat />
    </ScreenShell>
  )
}
