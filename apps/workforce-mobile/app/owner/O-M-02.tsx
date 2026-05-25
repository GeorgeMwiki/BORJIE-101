import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-02'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Bonyeza ujumbe">
          <AskBorjie />
        </Section>
        <Section title="Mazungumzo ya hivi karibuni">
          <PlaceholderList
            items={[
              { id: 'q1', primary: 'Je leseni Z inakwisha lini?' },
              { id: 'q2', primary: 'Onyesha mauzo ya wiki hii' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
