import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-16'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Uliza kwa Kiswahili">
          <AskBorjie />
        </Section>
        <Section title="Maswali ya hivi karibuni">
          <PlaceholderList
            items={[
              { id: 'q1', primary: 'Nifanye nini ikiwa fuel imekwisha?' },
              { id: 'q2', primary: 'Nina kuumia kidogo, je nirudi nyumbani?' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
