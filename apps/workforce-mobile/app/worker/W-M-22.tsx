import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-22'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mafunzo · Kiswahili">
          <PlaceholderList
            items={[
              { id: 'v1', primary: 'Jinsi ya kuvaa PPE', secondary: '2 min · offline' },
              { id: 'v2', primary: 'Jinsi ya kurekodi shifti', secondary: '3 min · offline' },
              { id: 'v3', primary: 'Hatari ya pit slope', secondary: '4 min · offline' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
