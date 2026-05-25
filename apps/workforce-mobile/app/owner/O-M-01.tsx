import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { BigNumber } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-01'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Kadi 3 za juu">
          <PlaceholderList
            items={[
              { id: 'd1', primary: 'Decision pending', secondary: 'Idhinisha · subiri' },
              { id: 'd2', primary: 'Risk flagged', secondary: 'Mgodi B · safety' },
              { id: 'd3', primary: 'Cash forecast', secondary: 'Siku 38 zilizobaki' }
            ]}
          />
        </Section>
        <Section title="Hela ya leo">
          <BigNumber value="TZS 184M" label="Salio jumla" caption="Siku 38" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
