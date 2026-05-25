import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-09'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Vikumbusho">
          <PlaceholderList
            items={[
              { id: 't90', primary: 'T-90 · PML 12345', secondary: '90 siku kabla' },
              { id: 't30', primary: 'T-30 · PML 67890', secondary: '30 siku kabla' },
              { id: 't7', primary: 'T-7 · PML 24680', secondary: '7 siku kabla' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
