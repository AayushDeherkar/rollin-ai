# Rollin' web — design direction

**The screen is an architect's drafting sheet.** It is laid on canary trace paper and drawn in technical-pen ink. A person's real wheelchair is driven through the plan, and the door that stops it is marked in redline. The audience is hospital case managers, and the judges watching on a projector at 1440×900.

All values live in [`tokens.css`](tokens.css). Nothing in `src/` may use a colour, font, font size, radius or easing that is not a token. Tailwind's default palette, type scale, fonts, radii, easings and shadows are switched off in `src/app/globals.css`, so a stray `bg-blue-500` or `text-xs` doesn't compile to anything.

## Palette

| Token | Hex | Job |
|---|---|---|
| `--paper` | `#efe6c6` | Canary trace paper, the ground |
| `--paper-lift` | `#f6f0da` | Bare paper under the plan |
| `--paper-deep` | `#e4d8b0` | Two sheets thick: hover, selected row, skeletons |
| `--rule` / `--rule-strong` | `#b8ab82` / `#8c8163` | Construction lines, panel rules |
| `--ink` | `#1b1f2a` | Technical-pen blue-black: walls, text |
| `--ink-soft` | `#4a4840` | Secondary text, dimension extension lines |
| `--agent` | `#1f3fa6` | **The one accent: cobalt markup pencil.** Used *only* while the agent is acting now. |
| `--reach` | `#2e6a3b` | Reachable: drafting green, flat wash, check icon |
| `--block` | `#a8231c` | Blocked / not passable: redline, 45° hatch, ban icon |
| `--unknown` | `#5e5949` | Not measured: graphite, stipple, question icon |

Status is never colour alone. Every status has a colour, a fill pattern (`PatternDefs` in `src/components/sheet/status.tsx`), an icon and a word.

## Type

- **Display:** Big Shoulders (a condensed sans in the spirit of drafting lettering) for panel titles, the wordmark and empty-state titles.
- **Text:** Public Sans (US Web Design System, built for legibility) for everything you read.
- **Measure:** IBM Plex Mono with tabular, slashed-zero figures for every number that is a measurement (`.measure`).
- Scale: 16 / 18 / 22 / 28 / 36 / 52 px. **Nothing is below 16 px.** Body text is 18 px.
- Sentence case. No tracked-out caps eyebrows.

## Plan drawing conventions

- Walls are solid ink at their measured thickness.
- Door widths are drawn as architectural dimension lines: extension lines, tick terminators and the figure in mono. The figure is red, with "not passable", when the chair cannot get through.
- Every estimated number carries "est." (for example `clear_in_est`). Turning space says "walls only". Fixture data is labelled as a synthetic contract fixture on screen.

## Motion

- One curve: `--ease-draft` = `cubic-bezier(0.22, 1, 0.36, 1)`, an ease-out with no overshoot.
- One duration scale: `--dur-1` 160 ms, `--dur-2` 320 ms, `--dur-3` 640 ms, `--dur-4` 1280 ms. JS mirror: `src/lib/motion.ts`.
- No springs, nothing bounces. `prefers-reduced-motion` sets every duration to 0, and the JS animations check `useReducedMotion()`.
- Unprompted motion goes to one moment only: the chair driving the plan.

## Layout

```
┌───────────────────────────── sheet frame (2px ink, hairline inside) ─────────────────────────────┐
│ Units (340)            │ Plan (fluid, brighter paper)                │ Agent (400)              │
│ ranked list, counts    │ walls, rooms by status, door dimension      │ plan → tool → finding    │
│ ✓ ⊘ ? per unit         │ lines, legend, chair, scenario toggle       │ chips, approval card     │
├──────────┬─────────────┴──────────┬───────────────────┬──────────────┴──────────┬──────────────┤
│ Rollin'  │ Unit                   │ Chair (w × l)     │ Scenario                │ Data          │ ← title block
└──────────┴────────────────────────┴───────────────────┴─────────────────────────┴──────────────┘
```

Left-aligned throughout. Panels are separated by drawing rules, not cards. Every panel has a designed empty state (a line of direction) and a loading state. Preview them with `?state=empty` and `?state=loading`.

## Banned

Purple or blue gradients · Inter · unthemed shadcn defaults · emoji icons · sparkle icons · glassmorphism · a white card grid · a centered hero with three feature cards · drop shadows · colour as the only status cue · any number not from the contract.
