import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-11'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mafuta">
          <PlaceholderList
            items={[
              { id: 'l', primary: 'Lita', secondary: '120 L' },
              { id: 'a', primary: 'Gari', secondary: 'Excavator-1' },
              { id: 't', primary: 'Muda', secondary: '14:32' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
