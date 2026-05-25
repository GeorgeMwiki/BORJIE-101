import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-21'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Hati ya kusaini">
          <PlaceholderList
            items={[
              { id: 'd', primary: 'Driver letter · LV-2231', secondary: 'Tani 7 · Geita -> Mwanza' }
            ]}
          />
        </Section>
        <Section title="Saini">
          <FingerprintPlaceholder label="Saini hapa" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
