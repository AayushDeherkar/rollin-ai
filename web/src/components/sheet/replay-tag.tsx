import { History } from "lucide-react";

/**
 * Marks data replayed from the contract fixtures because the API was not reachable.
 * Grey and outlined: it is a caveat, not a status, and never uses the agent accent.
 */
export function ReplayTag({ reason }: { reason: string | null }) {
  return (
    <span
      title={reason ? `Replaying contract fixtures. ${reason}` : "Replaying contract fixtures"}
      className="flex shrink-0 items-center gap-1.5 border border-ink-soft px-2 py-0.5 text-sm font-semibold text-ink-soft"
    >
      <History aria-hidden className="size-4" strokeWidth={2.25} />
      Replay
    </span>
  );
}
