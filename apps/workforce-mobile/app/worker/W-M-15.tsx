import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-15'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="PPE">
          <PlaceholderList
            items={[
              { id: 'i', primary: 'Helmet', secondary: 'Saizi L' },
              { id: 'b', primary: 'Boots', secondary: 'Saizi 42' }
            ]}
          />
        </Section>
        <Section title="Risiti">
          <FingerprintPlaceholder label="Nimepokea" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
