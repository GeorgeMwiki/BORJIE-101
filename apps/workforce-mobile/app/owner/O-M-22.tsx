import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useI18n } from '../../src/i18n/useI18n'

const SCREEN_ID = 'O-M-22'

export default function Screen(): JSX.Element {
  const { lang } = useI18n()
  const isSw = lang === 'sw'
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title={isSw ? 'Mahojiano ya Borjie' : 'Borjie interview'}>
          <AskBorjie label={isSw ? 'Anza mahojiano' : 'Start interview'} />
        </Section>
        <Section title={isSw ? 'Hatua' : 'Steps'}>
          <PlaceholderList
            items={[
              { id: 's1', primary: isSw ? '1. Jina la kampuni' : '1. Company name' },
              { id: 's2', primary: isSw ? '2. Leseni za PML' : '2. PML licences' },
              { id: 's3', primary: isSw ? '3. Migodi na timu' : '3. Sites and team' }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
