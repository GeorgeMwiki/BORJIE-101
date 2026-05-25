import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-05'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Tangu ping ya mwisho">
          <PlaceholderList
            items={[
              { id: 'l', primary: 'Mizigo: 3' },
              { id: 's', primary: 'Vizuizi: hakuna' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
