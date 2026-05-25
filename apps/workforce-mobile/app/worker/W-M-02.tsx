import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-02'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mpango wa leo">
          <PlaceholderList
            items={[
              { id: 'sh', primary: 'Shifti A · 06:00-18:00', secondary: 'Geita · pit 2' },
              { id: 'tk1', primary: '— kazi 1 — Drill 4 holes', secondary: 'Block B' },
              { id: 'tk2', primary: '— kazi 2 — Bag samples', secondary: 'Bench top' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
