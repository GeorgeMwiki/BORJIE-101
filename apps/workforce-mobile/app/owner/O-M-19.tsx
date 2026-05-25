import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-19'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Ripoti zilizoidhinishwa">
          <PlaceholderList
            items={[
              { id: 'r1', primary: 'Ripoti ya wiki · 21 Mei', secondary: 'Shiriki WhatsApp' },
              { id: 'r2', primary: 'Ripoti ya mwezi · Aprili', secondary: 'Shiriki WhatsApp' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
