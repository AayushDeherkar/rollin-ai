"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

const noSubscribe = () => () => {};
/** the reason the stage gave when it sent the viewer here (`/classic?why=…`), as plain text */
const readWhy = () => new URLSearchParams(window.location.search).get("why")?.slice(0, 160) ?? null;

/** On /classic after a fallback: says why the 3D stage did not run, and offers it again. */
export function FallbackNotice() {
  const why = useSyncExternalStore(noSubscribe, readWhy, () => null);
  const [closed, setClosed] = useState(false);
  if (!why || closed) return null;
  return (
    <div role="status" className="fixed bottom-6 left-6 z-50 flex max-w-[64ch] items-start gap-4 border border-rule-strong bg-paper-lift px-5 py-3 text-base">
      <p>
        The 3D stage could not run here: {why}. This is the plain layout with the same results.{" "}
        <Link href="/app" className="font-semibold underline underline-offset-4">
          Try the 3D stage
        </Link>
      </p>
      <button type="button" onClick={() => setClosed(true)} className="shrink-0 font-semibold text-ink-soft hover:text-ink">
        Dismiss
      </button>
    </div>
  );
}
