"use client";

/**
 * The design tokens, read from CSS at runtime for code that cannot use CSS (the 3D model).
 * tokens.css stays the only place a colour is defined.
 */
export interface Palette {
  paper: string;
  paperLift: string;
  paperDeep: string;
  rule: string;
  ruleStrong: string;
  ink: string;
  inkSoft: string;
  agent: string;
  reach: string;
  reachWash: string;
  block: string;
  blockWash: string;
  unknown: string;
  unknownWash: string;
  glow: number;
}

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    paper: v("--paper"),
    paperLift: v("--paper-lift"),
    paperDeep: v("--paper-deep"),
    rule: v("--rule"),
    ruleStrong: v("--rule-strong"),
    ink: v("--ink"),
    inkSoft: v("--ink-soft"),
    agent: v("--agent"),
    reach: v("--reach"),
    reachWash: v("--reach-wash"),
    block: v("--block"),
    blockWash: v("--block-wash"),
    unknown: v("--unknown"),
    unknownWash: v("--unknown-wash"),
    glow: Number(v("--glow")) || 0,
  };
}
