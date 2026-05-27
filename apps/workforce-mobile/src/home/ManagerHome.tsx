/**
 * Manager-home — preserved as a thin re-export of HomeChat so any caller
 * still importing `ManagerHome` after the chat-first home-tab pivot keeps
 * compiling. The page-level Manager home is now the chat surface; the
 * data-density cards from `src/home/manager/*` are emitted inline as
 * tool-renderable cards by the brain.
 */
import { HomeChat } from '../chat/HomeChat'

export function ManagerHome(): JSX.Element {
  return <HomeChat />
}
