import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'

const SCREEN_ID = 'O-M-14'

export default function Screen(): JSX.Element {
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title="Stoo">
          <PlaceholderList
            items={[
              { id: 'd', primary: 'Dieseli · 1,840 L', secondary: 'Siku 9 zilizobaki' },
              { id: 'p', primary: 'PPE helmet · 18', secondary: 'Siku 22 zilizobaki' },
              { id: 'g', primary: 'Grease · 24 kg', secondary: 'Siku 14 zilizobaki' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
