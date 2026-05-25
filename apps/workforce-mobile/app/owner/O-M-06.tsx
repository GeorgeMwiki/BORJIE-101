import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-06'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Ripoti ya siku">
          <PlaceholderList
            items={[
              { id: 'p', primary: 'Watu hudhuria: 24', secondary: 'Wamesha-ingia' },
              { id: 'l', primary: 'Mizigo: 18', secondary: 'Tani 36' },
              { id: 'f', primary: 'Mafuta: 220 L' },
              { id: 'b', primary: 'Vizuizi: 1', secondary: 'Excavator-2 imeharibika' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
