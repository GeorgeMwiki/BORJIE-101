import { ScreenShell } from '../../src/components/ScreenShell'
import { RoleGuard } from '../../src/components/RoleGuard'
import { HomeChat } from '../../src/chat/HomeChat'

const SCREEN_ID = 'home-chat'

/**
 * Chat-first home tab. The brain (POST /api/v1/brain/turn) is the
 * primary interaction; data surfaces inline as tool-renderable cards
 * routed by `ToolCallRenderer`. Role-aware greeting + suggestion chips
 * live in `HomeChat` itself, so this wrapper carries no role logic.
 */
export default function HomeTab(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID} scroll={false}>
        <HomeChat />
      </ScreenShell>
    </RoleGuard>
  )
}
