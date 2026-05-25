/**
 * Master Brain chat surface stub.
 *
 * Renders the visual shell of the owner's primary conversational
 * surface (O-W-02): a transcript area, an agent-call breadcrumb
 * strip, and a composer. Real wiring will swap the static transcript
 * for the streaming session backed by @borjie/chat-ui and the brain
 * kernel.
 *
 * Kept as a pure server component — no client state until the
 * streaming hook lands.
 */
export function ChatStub() {
  return (
    <section className="flex h-[520px] flex-col rounded-lg border border-border bg-surface/40">
      <div className="border-b border-border px-4 py-2 text-xs text-neutral-500">
        Agent call breadcrumbs:{' '}
        <span className="text-neutral-300">
          MasterBrain → StrategyMode → ForecasterAgent
        </span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        <div className="flex flex-col gap-1">
          <div className="text-[11px] text-neutral-500">Mzee Mwanaidi · 09:14</div>
          <div className="max-w-md rounded-lg bg-surface px-3 py-2 text-foreground">
            Tukiamua kununua excavator ya pili sasa, runway itakuwaje kwa miezi sita?
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-[11px] text-neutral-500">Master Brain · Strategy mode</div>
          <div className="max-w-lg rounded-lg border border-warning/40 bg-warning-subtle/20 px-3 py-2 text-foreground">
            Pamoja na lease ya miezi 24 kwa TZS 18M/mwezi, runway inashuka kutoka siku 71 hadi 52. Inashauriwa kusubiri Q3 baada ya kuuza Nyakabale stockpile.
            <div className="mt-2 text-[11px] text-neutral-400">
              Evidence: cockpit-mocks · cash 412.6M · burn 5.8M/day · Strategy simulator v0.2
            </div>
          </div>
        </div>
      </div>

      <form className="flex items-center gap-2 border-t border-border px-3 py-2">
        <input
          type="text"
          name="prompt"
          placeholder="Ask the Master Brain in Swahili or English..."
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-warning"
          disabled
        />
        <button
          type="button"
          disabled
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-neutral-400"
        >
          Send
        </button>
      </form>
    </section>
  );
}
