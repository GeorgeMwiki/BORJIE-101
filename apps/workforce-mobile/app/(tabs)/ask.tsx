import { ScreenShell } from '../../src/components/ScreenShell'
import { Section } from '../../src/components/Section'
import { AskBorjie } from '../../src/components/AskBorjie'
import { useAuth } from '../../src/auth/useAuth'

export default function AskTab(): JSX.Element {
  const { user } = useAuth()
  const screenId = user?.role === 'owner' ? 'O-M-02' : 'W-M-16'
  return (
    <ScreenShell screenId={screenId}>
      <Section title="Bonyeza ujumbe">
        <AskBorjie />
      </Section>
    </ScreenShell>
  )
}
