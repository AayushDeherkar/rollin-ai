"use client";

/**
 * The unit's Matterport tour, opened from a door the chair cannot pass, so the door can be seen
 * as scanned. Embedded (Matterport sends no frame-blocking headers today). A browser fires `load`
 * even for a refused frame, so refusal cannot be detected reliably: the frame that never loads
 * falls back to a link after a while, and "Open in a new tab" is always in the header.
 */
import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { Door } from "@/lib/contract";

/** How long a frame may take before we assume the embed was refused. */
const LOAD_MS = 12000;

export function tourUrl(sid: string, embed = false) {
  return `https://my.matterport.com/show/?m=${encodeURIComponent(sid)}${embed ? "&play=1" : ""}`;
}

export function TourPanel({ sid, unitName, door, onClose }: { sid: string; unitName: string; door: Door | null; onClose: () => void }) {
  const [state, setState] = useState<"loading" | "loaded" | "refused">("loading");
  // the door button that opened the panel is gone: move focus into the panel
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    if (state !== "loading") return;
    const t = setTimeout(() => setState("refused"), LOAD_MS);
    return () => clearTimeout(t);
  }, [state]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section aria-label={`Matterport tour of ${unitName}`} className="absolute inset-0 z-40 flex flex-col border border-ink bg-paper">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule-strong px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 ref={heading} tabIndex={-1} className="text-base font-semibold outline-none">
            Matterport tour, {unitName}
          </h3>
          {door && (
            <p className="text-sm text-ink-soft">
              The engine estimates this door at <span className="measure text-block">{door.clear_in_est.toFixed(1)} in</span> clear (est.). Walk to it in the
              tour to check it as scanned.
            </p>
          )}
        </div>
        <a
          href={tourUrl(sid)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-10 items-center gap-2 border border-rule-strong px-3 text-sm font-semibold transition-colors transition-draft hover:bg-paper-deep"
        >
          <ExternalLink aria-hidden className="size-4" strokeWidth={2.25} />
          Open in a new tab
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 items-center gap-2 border border-rule-strong px-3 text-sm font-semibold transition-colors transition-draft hover:bg-paper-deep"
        >
          <X aria-hidden className="size-4" strokeWidth={2.25} />
          Back to the model
        </button>
      </header>
      <div className="relative min-h-0 flex-1">
        {state !== "refused" ? (
          <iframe
            src={tourUrl(sid, true)}
            title={`Matterport tour of ${unitName}`}
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
            onLoad={() => setState("loaded")}
            className="absolute inset-0 h-full w-full border-0"
          />
        ) : (
          <div role="status" className="flex h-full flex-col items-start justify-center gap-3 px-8">
            <p className="text-lg font-semibold">The tour did not load here.</p>
            <p className="max-w-prose text-base text-ink-soft">
              Matterport may not allow it to be embedded on this page, or the network blocked it. Open it in a new tab instead.
            </p>
            <a
              href={tourUrl(sid)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-10 items-center gap-2 border border-ink px-3 text-sm font-semibold transition-colors transition-draft hover:bg-paper-deep"
            >
              <ExternalLink aria-hidden className="size-4" strokeWidth={2.25} />
              Open the tour
            </a>
          </div>
        )}
        {state === "loading" && <p className="pointer-events-none absolute top-3 left-3 bg-paper-lift px-2 text-sm text-ink-soft">Loading the tour…</p>}
      </div>
    </section>
  );
}
