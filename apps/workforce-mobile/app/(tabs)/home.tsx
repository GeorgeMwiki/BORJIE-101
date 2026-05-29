import { View, StyleSheet } from 'react-native'
import { ScreenShell } from '../../src/components/ScreenShell'
import { RoleGuard } from '../../src/components/RoleGuard'
import { HomeChat } from '../../src/chat/HomeChat'
import { WorkerHomeHero } from '../../src/components/WorkerHomeHero'
import { useAuth } from '../../src/auth/useAuth'

const SCREEN_ID = 'home-chat'

/**
 * Chat-first home tab. The brain (POST /api/v1/brain/turn) is the
 * primary interaction; data surfaces inline as tool-renderable cards
 * routed by `ToolCallRenderer`. Role-aware greeting + suggestion chips
 * live in `HomeChat` itself, so this wrapper carries no role logic.
 *
 * Roadmap R5: workers see a `WorkerHeroCard` above the chat with their
 * next task + shift state. Owners and managers keep the pure chat
 * experience.
 */
export default function HomeTab(): JSX.Element {
  const { user } = useAuth()
  const isWorker = (user?.role ?? 'employee') === 'employee'
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID} scroll={false}>
        <View style={styles.body}>
          {isWorker ? <WorkerHomeHero /> : null}
          <View style={styles.chatWrap}>
            <HomeChat />
          </View>
        </View>
      </ScreenShell>
    </RoleGuard>
  )
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  chatWrap: {
    flex: 1,
  },
})
