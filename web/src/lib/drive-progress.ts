"use client";

/**
 * One drive, shared by every view of it: the 3D model and the 2D plan read the same progress
 * value, so the chair is in the same place in both. Progress is a Motion value (0..1 along the
 * route by arc length plus turning), animated outside React so frames don't re-render.
 */
import { useEffect, useMemo } from "react";
import { animate, useMotionValue, useReducedMotionConfig, type MotionValue } from "motion/react";
import { sampler, type Drive, type RouteSampler } from "./chair";
import { DUR, EASE_DRAFT } from "./motion";

/** One glide: whole multiples of the longest duration step, so the scale stays one scale. */
export function glideSeconds(lengthM: number) {
  return DUR[4] * Math.max(1, Math.ceil(lengthM / 2.5));
}

export interface DriveProgress {
  progress: MotionValue<number>;
  s: RouteSampler;
}

/**
 * Animate a drive from the start whenever its route or `runId` changes. With reduced motion
 * the chair is placed where the drive ends. `onStart` / `onSettled` keep the caller's
 * "driving" state in step with the animation; they must be stable.
 */
export function useDriveProgress(drive: Drive | null, runId: number, onStart: () => void, onSettled: () => void): DriveProgress {
  const reduce = useReducedMotionConfig();
  // key on the route's values: a scenario switch that leaves the route unchanged must not replay
  const routeKey = drive ? JSON.stringify(drive.route) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const s = useMemo(() => sampler(drive?.route ?? []), [routeKey]);
  const progress = useMotionValue(reduce ? 1 : 0);

  useEffect(() => {
    if (!drive) return;
    if (reduce || s.length === 0) {
      progress.jump(1);
      onSettled();
      return;
    }
    progress.jump(0);
    onStart();
    const controls = animate(progress, 1, { duration: glideSeconds(s.length), ease: EASE_DRAFT, onComplete: onSettled });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, runId, reduce, drive == null]);

  return { progress, s };
}
