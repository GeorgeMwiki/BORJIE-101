import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-24'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Arifa zako">
          <PlaceholderList
            items={[
              { id: 'n1', primary: 'Push · Maamuzi mapya', secondary: 'Ndani ya dakika 30' },
              { id: 'n2', primary: 'WA · Ripoti ya shifti', secondary: 'Ndani ya saa 1' },
              { id: 'n3', primary: 'SMS · Cash low alert', secondary: 'Mara moja' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
