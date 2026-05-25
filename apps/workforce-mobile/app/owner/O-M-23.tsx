import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-23'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mpango">
          <PlaceholderList
            items={[
              { id: 'p', primary: 'Pro · TZS 980,000 / mwezi', secondary: 'Hadi watumiaji 25' }
            ]}
          />
        </Section>
        <Section title="Timu">
          <PlaceholderList
            items={[
              { id: 'u1', primary: 'Bwana Mkubwa', secondary: 'owner' },
              { id: 'u2', primary: 'Meneja wa Geita', secondary: 'manager' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
