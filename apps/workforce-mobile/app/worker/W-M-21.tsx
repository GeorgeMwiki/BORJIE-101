import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useQueueSize } from '../../src/sync/useQueueSize'
import { useOnlineStatus } from '../../src/offline/useOnlineStatus'

const SCREEN_ID = 'W-M-21'

export default function Screen(): JSX.Element {
  const queue = useQueueSize()
  const { online } = useOnlineStatus()
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Foleni ya kupakia">
          <BigNumber value={String(queue)} label="Inangoja" caption={online ? 'Mtandaoni' : 'Bila mtandao'} />
        </Section>
        <Section title="Upatanisho">
          <PlaceholderList
            items={[
              { id: 's1', primary: 'Shift report · 2026-05-24' },
              { id: 's2', primary: 'Fuel log · 2026-05-24' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
