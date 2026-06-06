import { ScreenShell } from '../../src/components/ScreenShell'
import { RoleGuard } from '../../src/components/RoleGuard'
import { HomeChat } from '../../src/chat/HomeChat'

const SCREEN_ID = 'O-M-02'

/**
 * Owner "Ask Borjie" screen. Renders the live `HomeChat` surface, which
 * streams against POST /api/v1/brain/turn (`streamBrainTurn`) — the same
 * real brain endpoint the Home tab uses. The previous owner-only stack
 * (`useChat` → `streamChat` → /api/v1/mining/chat) has been removed so the
 * whole app shares one real chat path.
 */
export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID} scroll={false}>
        <HomeChat />
      </ScreenShell>
    </RoleGuard>
  )
}
