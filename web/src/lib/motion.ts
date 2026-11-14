/**
 * Motion tokens for JS (Motion library). Mirrors --ease-draft and --dur-* in web/tokens.css.
 * One easing curve, one duration scale, no springs, nothing bounces.
 */
export const EASE_DRAFT = [0.22, 1, 0.36, 1] as const;

/** seconds */
export const DUR = {
  1: 0.16,
  2: 0.32,
  3: 0.64,
  4: 1.28,
} as const;
