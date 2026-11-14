# Rollin' web — design direction

**The screen is a site model at night.** An architect's card model of the apartment sits on a dark base board. A person's real wheelchair drives through it, and the door that stops it lights up. The drafting conventions carry over from the earlier sheet: walls are measured, door widths are dimensioned, and every estimate says "est.". The audience is hospital case managers, and the judges watching on a projector at 1440×900.

All values live in [`tokens.css`](tokens.css). Nothing in `src/` may use a colour, font, font size, radius or easing that is not a token. Tailwind's default palette, type scale, fonts, radii, easings and shadows are switched off in `src/app/globals.css`, so a stray `bg-blue-500` or `text-xs` doesn't compile to anything. The 3D model reads the same tokens at runtime (`src/lib/tokens.ts`), so it has no colours of its own.

## Palette

The token names keep their jobs from the drafting sheet: `paper` is the ground and `ink` is linework and text.

| Token | Hex | Job |
|---|---|---|
| `--paper` | `#0f1113` | The night ground around the model |
| `--paper-lift` | `#15181b` | The base board under the model and the 2D plan |
| `--paper-deep` | `#1d2024` | A step lighter: hover, selected row, skeletons |
| `--rule` / `--rule-strong` | `#2b2f34` / `#4a5057` | Construction lines, panel rules |
| `--ink` | `#ebe7dc` | Pale model card: walls, text |
| `--ink-soft` | `#a9a59a` | Secondary text, dimension extension lines |
| `--agent` | `#8ea2ff` | **The one accent: cobalt.** Used *only* while the agent is acting now (streaming, a decision in flight, the chair driving). |
| `--reach` | `#7cc98b` | Reachable: flat wash, check icon |
| `--block` | `#ff7a6b` | Blocked / not passable: 45° hatch, ban icon |
| `--unknown` | `#a39f94` | Not measured: stipple, question icon |
| `--glow` | `0.22` | How much a status floor glows in the model. Restrained: a status is a lit floor, not a neon sign. |

Status is never colour alone. Every status has a colour, a fill pattern (`PatternDefs` in `src/components/sheet/status.tsx`; the same hatch and stipple are painted on the model's floors), an icon and a word.

## Type

- **Display:** Big Shoulders (a condensed sans in the spirit of drafting lettering) for panel titles, the wordmark and empty-state titles.
- **Text:** Public Sans (US Web Design System, built for legibility) for everything you read.
- **Measure:** IBM Plex Mono with tabular, slashed-zero figures for every number that is a measurement (`.measure`).
- Scale: 16 / 18 / 22 / 28 / 36 / 52 px. **Nothing is below 16 px.** Body text is 18 px.
- Sentence case. No tracked-out caps eyebrows.

## The model (3D, main view)

- Built only from the contract: each wall is extruded from `a` to `b` at its thickness to 2.4 m, with gaps at doors from `width_in` and `center`. Model coordinates are metres with Z up; three.js gets `(x, z, -y)`.
- Floors are lit by status with the same patterns as the plan. The chair is sized from `chair_in`; its footprint rectangle is the shape the engine tested.
- The camera orbits slowly at rest and follows the chair while it drives. The blocking door's frame lights up in the blocked colour, and the callout gives clear width, chair width and shortfall, marked est.
- "With offset hinges": door leaves swing clear and rooms take the engine's hinges result.
- Lazy-loaded. The pixel ratio is capped at 1.5. The 2D plan is the inset, and it becomes the main view when WebGL is missing, the model fails, or it runs under 24 fps. `?view=2d` and `?view=3d` force a view.
- Reduced motion: a fixed camera, no drive animation (the chair is shown where it ends), and door leaves set without swinging.

## Plan drawing conventions (2D plan)

- Walls are solid ink at their measured thickness.
- Door widths are drawn as architectural dimension lines: extension lines, tick terminators and the figure in mono. The figure is red, with "not passable", when the chair cannot get through.
- Every estimated number carries "est." (for example `clear_in_est`). Turning space says "walls only". Fixture data is labelled as a synthetic contract fixture on screen.

## Motion

- One curve: `--ease-draft` = `cubic-bezier(0.22, 1, 0.36, 1)`, an ease-out with no overshoot.
- One duration scale: `--dur-1` 160 ms, `--dur-2` 320 ms, `--dur-3` 640 ms, `--dur-4` 1280 ms. JS mirror: `src/lib/motion.ts`.
- No springs, nothing bounces. `prefers-reduced-motion` sets every duration to 0, and the JS animations check `useReducedMotion()`.
- Unprompted motion goes to one moment only: the chair driving the model, with the slow orbit that frames it at rest.

## Layout

```
┌───────────────────────────── sheet frame (2px ink, hairline inside) ─────────────────────────────┐
│ Units (300)            │ Model (fluid, base board), 2D plan inset    │ Agent (360)              │
│ ranked list, counts    │ walls, lit floors by status, chair, door    │ plan → tool → finding    │
│ ✓ ⊘ ? per unit         │ callout, legend, scenario toggle            │ chips, approval card     │
├──────────┬─────────────┴──────────┬───────────────────┬──────────────┴──────────┬──────────────┤
│ Rollin'  │ Unit                   │ Chair (w × l)     │ Scenario                │ Data          │ ← title block
└──────────┴────────────────────────┴───────────────────┴─────────────────────────┴──────────────┘
```

Left-aligned throughout. Panels are separated by drawing rules, not cards. Every panel has a designed empty state (a line of direction) and a loading state. Preview them with `?state=empty` and `?state=loading`.

## Banned

Purple or blue gradients · Inter · unthemed shadcn defaults · emoji icons · sparkle icons · glassmorphism · a white card grid · a centered hero with three feature cards · drop shadows · bloom or neon glow · colour as the only status cue · any number not from the contract.
