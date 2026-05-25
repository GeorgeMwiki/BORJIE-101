import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-11'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Kazi za kuthibitisha">
          <PlaceholderList
            items={[
              { id: 't1', primary: 'Approve fuel PO #482' },
              { id: 't2', primary: 'Approve hire: Surveyor' },
              { id: 't3', primary: 'Reject overtime: Excav-2' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
