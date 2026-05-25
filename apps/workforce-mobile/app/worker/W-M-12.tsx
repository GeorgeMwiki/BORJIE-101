import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-12'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Masaa ya mashine">
          <PlaceholderList
            items={[
              { id: 's', primary: 'Anza odometer', secondary: '12,418.2' },
              { id: 'e', primary: 'Mwisho odometer', secondary: '12,428.6' },
              { id: 't', primary: 'Jumla', secondary: '10.4 hrs' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
