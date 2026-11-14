"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { DUR, EASE_DRAFT } from "@/lib/motion";

/** A measurement that counts to its new value when the scenario changes (mono, tabular). */
export function AnimatedFigure({ value, digits = 1, svg = false, className }: { value: number; digits?: number; svg?: boolean; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toFixed(digits));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: DUR[3], ease: EASE_DRAFT });
    return () => c.stop();
  }, [value, reduce, mv]);

  return svg ? <motion.tspan className={className}>{text}</motion.tspan> : <motion.span className={className}>{text}</motion.span>;
}
