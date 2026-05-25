import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-16'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Ahadi za jamii">
          <BigNumber value="62%" label="Ahadi zilizotekelezwa" />
        </Section>
        <Section title="Malalamiko">
          <PlaceholderList
            items={[
              { id: 'c1', primary: 'Vumbi · kijiji A', secondary: 'Wazi · siku 5' },
              { id: 'c2', primary: 'Maji · borehole 3', secondary: 'Imefungwa' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
