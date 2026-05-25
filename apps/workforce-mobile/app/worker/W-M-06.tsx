import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { CountTap } from '../../src/components/StubBlocks'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-06'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Hesabu ya scoop" hint="Gusa kila scoop">
          <CountTap label="SCOOP" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
