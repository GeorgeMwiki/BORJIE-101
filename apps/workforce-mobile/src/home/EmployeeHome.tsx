/**
 * Employee-home — preserved as a thin re-export of HomeChat so any caller
 * still importing `EmployeeHome` after the chat-first home-tab pivot keeps
 * compiling. The page-level Employee home is now the chat surface; the
 * data-density cards from `src/home/employee/*` are emitted inline as
 * tool-renderable cards by the brain.
 */
import { HomeChat } from '../chat/HomeChat'

export function EmployeeHome(): JSX.Element {
  return <HomeChat />
}
