import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { BigNumber } from '../../src/components/StubBlocks'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-17'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Bei ya dhahabu">
          <BigNumber value="USD 2,360 / oz" label="Bei ya sasa" caption="Tofauti +1.2%" />
        </Section>
        <Section title="Pendekezo">
          <PlaceholderList
            items={[
              { id: 'r', primary: 'Uza sasa', secondary: 'Bei juu ya wastani wa wiki' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
