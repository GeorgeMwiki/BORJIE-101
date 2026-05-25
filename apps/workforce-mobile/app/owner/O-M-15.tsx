import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-15'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Vidhibiti muhimu vilivyo wazi">
          <BigNumber value="3" label="Hatua wazi" />
        </Section>
        <Section title="Matukio">
          <PlaceholderList
            items={[
              { id: 'i1', primary: 'Near-miss · pit slope', secondary: 'Mei 22' },
              { id: 'i2', primary: 'Injury · hand · minor', secondary: 'Mei 18' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
