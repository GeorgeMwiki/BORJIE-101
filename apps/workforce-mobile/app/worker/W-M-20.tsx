import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-20'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Barua ya dereva">
          <PlaceholderList
            items={[
              { id: 'l', primary: 'Driver letter · LV-2231', secondary: 'Tani 7 · safi' },
              { id: 's', primary: 'Shiriki kwa WhatsApp' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
