import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-10'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Vifaa vya kuuza">
          <PlaceholderList
            items={[
              { id: 'p1', primary: 'Parcel 001 · 2.4 t Au', secondary: 'Net USD 38,200' },
              { id: 'p2', primary: 'Parcel 002 · 1.1 t Cu', secondary: 'Net USD 6,800' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
