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
- Doors the chair cannot pass have a block-coloured frame and a dashed sill across the opening (dashed means "does not fit", as for turning circles).
- "With offset hinges": door leaves swing clear and rooms take the engine's hinges result.
- Drawing proportions, not data: wall height 2.4 m, door head 2.03 m, leaf thickness and swing angles, and the chair's seat, back and wheels. Only the walls' plan positions and thickness, door widths and centres, room shapes and statuses, the route and the chair's width × length footprint come from the contract. Nothing on screen reads the drawn proportions as measurements.
- Lazy-loaded. The pixel ratio is capped at 1.5. In `/classic` the 2D plan is the inset, and it becomes the main view when WebGL is missing, the model fails, or it runs under 24 fps. `?view=2d` and `?view=3d` force a view.
- Reduced motion: a fixed camera, no drive animation (the chair is shown where it ends), and door leaves set without swinging.

## Plan drawing conventions (2D plan)

- Walls are solid ink at their measured thickness.
- Door widths are drawn as architectural dimension lines: extension lines, tick terminators and the figure in mono. The figure is red, with "not passable", when the chair cannot get through.
- Every estimated number carries "est." (for example `clear_in_est`). Turning space says "walls only". Fixture data is labelled as a synthetic contract fixture on screen.

## Motion

- One curve: `--ease-draft` = `cubic-bezier(0.22, 1, 0.36, 1)`, an ease-out with no overshoot.
- One duration scale: `--dur-1` 160 ms, `--dur-2` 320 ms, `--dur-3` 640 ms, `--dur-4` 1280 ms. JS mirror: `src/lib/motion.ts`.
- No springs, nothing bounces. `prefers-reduced-motion` sets every duration to 0, and the JS animations check `useReducedMotion()`.
- Unprompted motion goes to one moment only: the camera's flight between steps, and the chair driving at the end of it.

## The stage (Round 4)

**One model table, one camera, three distances.** The product owner found the three-panel sheet generic, so `/` is now a single full-screen 3D stage and the camera is the guide. Nothing cuts: the camera travels from the chair, up over the city, and down into one apartment in one unbroken move. That flight is the one bold thing on the page; everything floating over it stays quiet. The three-panel sheet lives on, unchanged, at `/classic`, and is the fallback.

The memorable element is the descent: the chair you just sized shrinks to a pin at the medical center, the units rise around it as survey points, and the camera drops onto the one that fits until its walls stand up around you.

### Scenes

The steps are a real sequence, so the step bar numbers them.

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Rollin'   1 Chair ── 2 Search ── 3 Apartment                         (agent pill)        │ ← step bar, top-left; pill top-right
│                                                                                          │
│                         [ full-screen canvas: the scene for the step ]                   │
│                                                                                          │
│ scene plate, bottom-left (the controls for this step)              cards / room card,    │
│                                                                    right edge            │
│ narration line: one sentence, what is happening now                                      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Chair.** A large chair stands on the board under a work light, its footprint drawn at the size the engine will test. Its turning circle is drawn on the floor: the circle the footprint sweeps when it turns in place (its diagonal, computed, not measured), with the 60 in turning space the engine checks bathrooms against (walls only) as a dashed reference ring. The plate bottom-left holds three presets (manual chair, power chair, walker), a width slider and a length slider with the figures in mono, and one primary button: **Find where this fits**. It sets the profile (`chair_in`, `sender_id`) and starts the search.
2. **Search.** The chair recedes to a pin at the medical center, and the units appear around it as points placed by latitude and longitude (an equirectangular projection around the medical center; no map tiles, so it works offline). Rings at 2, 5 and 10 km give scale. Points start graphite (not checked). As agent events arrive, points the agent checks turn reachable (green, raised post), blocked (red, short post with a cross-bar) or unknown (graphite, hollow). One narration line at the bottom says the current step in plain words. When the run finishes, the top three rise as cards on the right with a one-line reason each; clicking one flies into it. The full trace sits behind a small agent pill top-right that expands on click. An approval question appears as a focused card centred low over the scene, never as a log line.
3. **Apartment.** The dollhouse, full screen. A headline verdict top-left under the step bar is computed from room statuses: "5 of 7 rooms reachable. 1 fixable with offset hinges. 1 needs the landlord." A room strip along the bottom lists every room with its status icon and word. Selecting a room flies the camera to it and shows one room card on the right with a fixed shape: status, the reason in one sentence, the fix if any, and the basis (measured, estimated, from a photo, from the aerial), with its evidence one click away (tour panel, panorama image, aerial card). At a blocking door a ruler snaps across the opening: clear width, chair width and the shortfall, marked est. **Try offset hinges** swings the leaf clear, turns the ruler green, rolls the chair in and updates the verdict. **Ride along** puts the camera at seated eye height (drawn proportion: 1.2 m) behind the chair along its path. A legend and one-line hints help first-time users; the hints go away once used.

### Floating interface

- Plates, not cards: `paper-lift` ground, 2px `ink` border for the one focused plate (approval, room card), hairline `rule-strong` for the rest, the 2px radius. No shadows, no blur, no translucency over the scene (glassmorphism is banned): plates are opaque.
- Left-aligned text everywhere. The narration line is 22px Public Sans; verdicts and step names use Big Shoulders.
- Status is never colour alone: points carry a shape (post, cross-bar, hollow ring), rooms carry hatch, icon and word.
- The accent cobalt appears only while the agent is acting: the pill while streaming, the narration bullet, the checking pulse on a point, the chair while it drives.
- Keyboard: steps, presets, sliders, cards, room strip and every evidence link are real buttons and inputs. Esc closes the pill, the evidence and the approval card's details.

### Camera choreography

- A single director owns the camera. Each step (and each sub-state: a selected room, ride along) names a goal pose; the camera eases toward it every frame with the draft curve's feel (exponential ease-out, no overshoot), so a change of step mid-flight bends the path instead of cutting it.
- Chair: low and close, three-quarter view. Search: high over the medical center, the field filling the screen. Apartment: over the chosen unit's point, close enough that the model fills the screen; the field fades as the walls rise.
- Reduced motion (OS setting or `?motion=reduce`): fixed cameras per step, set at once, no flights, no orbit, no drive animation.

### Presenter, fallback and public replay

- `?demo=1` opens step 3 on `demo-main` (resolved by the API's health, never a hard-coded id) with the chair stopped at the bedroom door. `R` resets the demo.
- No WebGL, a lost context, or a frame rate under 24 fps: the page sends you to `/classic` and says why there.
- The public build is fixture-only: synthetic apartment, no API URL, no keys, and a visible "Replay with a synthetic apartment" label.

## Banned

A dashboard grid · a three-panel layout on the stage · purple or blue gradients · Inter · unthemed shadcn defaults · emoji icons · sparkle icons · glassmorphism · a white card grid · a centered hero with three feature cards · drop shadows · bloom or neon glow · colour as the only status cue · any number not from the contract.
