"use client";

/**
 * The plan panel's stage: the 3D model as the main view with the 2D plan as an inset, or the
 * 2D plan alone when WebGL is missing, the model fails or runs slowly (it says why), or when
 * the viewer asks for it. `?view=2d` / `?view=3d` force a view for testing.
 */
import { useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Box, Map as MapIcon } from "lucide-react";
import type { MotionValue } from "motion/react";
import type { Floor, UnitResult } from "@/lib/contract";
import type { Drive, RouteSampler } from "@/lib/chair";

const Dollhouse = dynamic(
  () => import("@/components/dollhouse/dollhouse").then((m) => m.Dollhouse),
  {
    ssr: false,
    loading: () => (
      <p className="absolute inset-0 flex items-center justify-center text-base text-ink-soft">
        Building the 3D model…
      </p>
    ),
  },
);

type View = "3d" | "2d";
const noSubscribe = () => () => {};
function readView(): View | null {
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "2d" || v === "3d" ? v : null;
}

let webgl: boolean | undefined;
/** whether this browser can make a WebGL context; checked once */
function readWebgl(): boolean {
  if (webgl === undefined) {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      webgl = Boolean(gl);
      // release the test context; browsers cap how many can be live at once
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

/**
 * Why the 3D model gave way, and which view the viewer picked. Kept for the page's life, not the
 * stage's: the stage remounts on every unit change, and a slow GPU should not be retried each time.
 */
const stage: { fallback: string | null; chosen: View | null } = {
  fallback: null,
  chosen: null,
};
const listeners = new Set<() => void>();
const subscribeStage = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
function setStage(patch: Partial<typeof stage>) {
  Object.assign(stage, patch);
  listeners.forEach((l) => l());
}
const readFallback = () => stage.fallback;
const readChosen = () => stage.chosen;
const onFallback = (reason: string) => {
  if (!stage.fallback) setStage({ fallback: reason });
};
const choose = (v: View) => setStage({ chosen: v });

export function PlanStage({
  unit,
  floor,
  drive,
  driving,
  progress,
  s,
  selectedRoom,
  onRoomSelect,
  onDoorOpen,
  renderPlan,
}: {
  unit: UnitResult;
  floor: Floor;
  drive: Drive | null;
  driving: boolean;
  progress: MotionValue<number>;
  s: RouteSampler;
  selectedRoom: string | null;
  onRoomSelect: (roomId: string) => void;
  onDoorOpen?: (edge: string) => void;
  /** the 2D plan, full size or as the compact inset */
  renderPlan: (compact: boolean) => ReactNode;
}) {
  const forced = useSyncExternalStore(noSubscribe, readView, () => null);
  const supported = useSyncExternalStore<boolean | null>(
    noSubscribe,
    readWebgl,
    () => null,
  );
  const fallback = useSyncExternalStore(
    subscribeStage,
    readFallback,
    () => null,
  );
  const chosen = useSyncExternalStore(subscribeStage, readChosen, () => null);

  const reason =
    fallback ??
    (supported === false ? "WebGL is not available in this browser" : null);
  const view: View = forced === "2d" || reason ? "2d" : (chosen ?? "3d");
  if (supported === null && forced !== "2d") return null;

  if (view === "2d") {
    return (
      <div className="relative h-full w-full">
        {renderPlan(false)}
        {reason ? (
          <p
            role="status"
            className="absolute bottom-2 left-3 bg-paper-lift/90 px-2 text-sm text-ink-soft"
          >
            Showing the 2D plan: {reason}.
          </p>
        ) : (
          forced !== "2d" && (
            <button
              type="button"
              onClick={() => choose("3d")}
              className="absolute top-3 left-3 flex h-10 items-center gap-2 border border-rule-strong bg-paper-lift px-3 text-sm font-semibold transition-colors transition-draft hover:bg-paper-deep"
            >
              <Box aria-hidden className="size-4" strokeWidth={2.25} />
              Show the 3D model
            </button>
          )
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* isolate: the model's HTML labels carry z-indexes; keep them under the inset */}
      <div className="absolute inset-0 isolate">
        <Dollhouse
          unit={unit}
          floor={floor}
          drive={drive}
          driving={driving}
          progress={progress}
          s={s}
          selectedRoom={selectedRoom}
          onRoomSelect={onRoomSelect}
          onDoorOpen={onDoorOpen}
          onFallback={onFallback}
        />
      </div>
      {/* the 2D plan as an inset; it opens full size */}
      <button
        type="button"
        onClick={() => choose("2d")}
        aria-label="Show the 2D plan"
        className="group absolute bottom-3 left-3 h-48 w-64 border border-rule-strong bg-paper-lift transition-colors transition-draft hover:border-ink"
      >
        <span className="pointer-events-none absolute inset-0">
          {renderPlan(true)}
        </span>
        <span className="absolute top-1.5 left-2 flex items-center gap-1.5 bg-paper-lift/90 px-1 text-sm font-semibold text-ink-soft group-hover:text-ink">
          <MapIcon aria-hidden className="size-4" strokeWidth={2.25} />
          2D plan
        </span>
      </button>
    </div>
  );
}
