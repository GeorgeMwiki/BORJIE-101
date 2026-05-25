import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-13'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mali na magari">
          <PlaceholderList
            items={[
              { id: 'e1', primary: 'Excavator-1 · 72%', secondary: 'Huduma baada ya siku 4' },
              { id: 'e2', primary: 'Excavator-2 · 41%', secondary: 'Huduma sasa' },
              { id: 't1', primary: 'Tipper 7-tonne · 88%' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
