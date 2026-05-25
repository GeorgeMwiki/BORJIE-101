import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-07'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Muda uliobaki">
          <BigNumber value="38" label="Siku za hela" caption="Kabla ya kufungwa" />
        </Section>
        <Section title="Mfuko">
          <PlaceholderList
            items={[
              { id: 'tzs', primary: 'TZS', secondary: '184,000,000' },
              { id: 'usd', primary: 'USD', secondary: '74,000' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
