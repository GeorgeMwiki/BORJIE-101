import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-18'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Hati ya kusaini">
          <PlaceholderList
            items={[{ id: 'd', primary: 'Driver letter · LV-2231' }]}
          />
        </Section>
        <Section title="Saini">
          <FingerprintPlaceholder label="Saini kwa kidole" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
