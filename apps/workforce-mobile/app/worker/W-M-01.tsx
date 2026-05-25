import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { FingerprintPlaceholder } from '../../src/components/FingerprintPlaceholder'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'W-M-01'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Simu yako">
          <PlaceholderList items={[{ id: 'p', primary: '+255 7•• ••• ••0' }]} />
        </Section>
        <Section title="Saini ya kuingia">
          <FingerprintPlaceholder label="Ingia kwa kidole" />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
