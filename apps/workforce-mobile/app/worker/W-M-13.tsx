import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-13'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mada ya leo">
          <PlaceholderList
            items={[{ id: 'm', primary: 'Lockout / Tagout', secondary: '5 dakika' }]}
          />
        </Section>
        <Section title="Thibitisho">
          <FingerprintPlaceholder label="Nimekubali" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
