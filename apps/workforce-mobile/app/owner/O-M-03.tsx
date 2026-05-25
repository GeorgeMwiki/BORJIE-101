import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-03'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Maamuzi yanayosubiri" hint="Sababu 4 kwa kila moja">
          <PlaceholderList
            items={[
              { id: 'a1', primary: 'Renew PML 12345', secondary: 'Sababu 1..4' },
              { id: 'a2', primary: 'Approve fuel order', secondary: 'TZS 8.4M' },
              { id: 'a3', primary: 'Sign-off shift B', secondary: 'Mfanyakazi 12' }
            ]}
          />
        </Section>
        <Section title="Saini ya kidole">
          <FingerprintPlaceholder label="Saini hapa" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
