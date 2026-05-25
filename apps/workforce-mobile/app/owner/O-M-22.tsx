import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-22'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Mahojiano ya Borjie">
          <AskBorjie label="Anza mahojiano" />
        </Section>
        <Section title="Hatua">
          <PlaceholderList
            items={[
              { id: 's1', primary: '1. Jina la kampuni' },
              { id: 's2', primary: '2. Leseni za PML' },
              { id: 's3', primary: '3. Migodi na timu' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
