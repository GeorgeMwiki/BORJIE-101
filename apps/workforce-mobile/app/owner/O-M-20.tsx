import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-20'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Soko">
          <PlaceholderList
            items={[
              { id: 'm1', primary: 'Service: Surveyor', secondary: '⭐ 4.7 · Geita' },
              { id: 'm2', primary: 'Equipment: 25t Tipper', secondary: '⭐ 4.4 · Mwanza' },
              { id: 'm3', primary: 'Logistics: Mineral haul', secondary: '⭐ 4.9 · Chunya' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
