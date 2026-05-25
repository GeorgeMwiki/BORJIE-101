import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-18'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Hesabu ya cliff">
          <BigNumber value="307" label="Siku hadi Mar-27-2026" caption="Mikataba ya USD inafaa kubadilishwa" />
        </Section>
        <Section title="Mikataba">
          <PlaceholderList
            items={[
              { id: 'c1', primary: 'Off-take A', secondary: 'USD · ya kubadilisha' },
              { id: 'c2', primary: 'Off-take B', secondary: 'TZS · safi' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
