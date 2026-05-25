import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { PromptRegistry } from '@/components/internal/prompts/PromptRegistry';

const SCREEN = findScreen('prompts')!;

export default function PromptsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <PromptRegistry />
    </ScreenShell>
  );
}
