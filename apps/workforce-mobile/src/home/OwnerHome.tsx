/**
 * Owner-home — preserved as a thin re-export of HomeChat so any caller
 * still importing `OwnerHome` after the chat-first home-tab pivot keeps
 * compiling. The page-level Owner home is now the chat surface; the
 * data-density cards from `src/home/owner/*` are emitted inline as
 * tool-renderable cards by the brain.
 */
import { HomeChat } from '../chat/HomeChat'

export function OwnerHome(): JSX.Element {
  return <HomeChat />
}
