import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { PlaceholderList } from '../../src/components/PlaceholderList'
import { RoleGuard } from '../../src/components/RoleGuard'
import { useI18n } from '../../src/i18n/useI18n'

const SCREEN_ID = 'O-M-22'

export default function Screen(): JSX.Element {
  const { t } = useI18n()
  const copy = t.ownerScreens
  return (
    <RoleGuard screenId={SCREEN_ID}>
      <ScreenShell screenId={SCREEN_ID}>
        <Section title={copy.interviewTitle}>
          <AskBorjie label={copy.startInterview} />
        </Section>
        <Section title={copy.stepsTitle}>
          <PlaceholderList
            items={[
              { id: 's1', primary: copy.step1Company },
              { id: 's2', primary: copy.step2Pml },
              { id: 's3', primary: copy.step3Sites }
            ]}
          />
        </Section>
      </ScreenShell>
    </RoleGuard>
  )
}
