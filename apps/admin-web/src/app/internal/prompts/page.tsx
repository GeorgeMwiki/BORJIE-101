import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { PromptRegistry } from '@/components/internal/prompts/PromptRegistry';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('prompts')!;

export default async function PromptsPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN}>
      <PromptRegistry initialLocale={locale} />
    </ScreenShell>
  );
}
