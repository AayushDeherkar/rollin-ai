"use client";

/**
 * The landing page at /. One 3D scene stays fixed behind the story (a chair stopped at a doorway that
 * is too narrow for it); scrolling the story moves the camera through it: the problem, then the three
 * steps (measure, test-drive, ask). Then the batch's numbers from /api/insights, the way into the app,
 * and what is measured, estimated and unknown. GSAP ScrollTrigger and Lenis run here only. Reduced
 * motion: the chair is already stopped, no smooth scrolling, no scroll animation.
 */
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import Lenis from "lenis";
import { ChevronDown } from "lucide-react";
import presetsJson from "../../../../data/chair_presets.json";
import type { Story } from "./door-scene";
import { SweepChart, useSweep, type Sweep } from "./numbers";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const DoorScene = dynamic(() => import("./door-scene").then((m) => m.DoorScene), { ssr: false });

/** the hero's chair is this sourced preset (door-scene.tsx draws 27.0 × 39.8 in) */
const HERO_PRESET = presetsJson.presets.find((p) => p.name === "Manual wheelchair (average user)") ?? null;

export function Landing() {
  const reduce = useReducedMotion() ?? false;
  const story = useRef<Story>({ s: 0 });
  const storyEl = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<SVGPathElement>(null);
  const [live, setLive] = useState(true);
  const { sweep, state } = useSweep();

  // the canvas draws only while the story is on screen
  useEffect(() => {
    const el = storyEl.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setLive(e.isIntersecting), { rootMargin: "0px 0px -10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // smooth scrolling, landing only
  useEffect(() => {
    if (reduce) return;
    const lenis = new Lenis({ anchors: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, [reduce]);

  // each beat scrolling in carries the camera from the previous pose to its own
  useGSAP(
    () => {
      if (reduce) return;
      gsap.utils.toArray<HTMLElement>("[data-beat]").forEach((el) => {
        const beat = Number(el.dataset.beat);
        ScrollTrigger.create({
          trigger: el,
          start: "top bottom",
          end: "top 25%",
          scrub: true,
          onUpdate: (st) => {
            if (st.progress > 0 && st.progress <= 1) story.current.s = beat - 1 + st.progress;
          },
          onLeaveBack: () => {
            story.current.s = beat - 1;
          },
        });
      });
    },
    { scope: root, dependencies: [reduce] },
  );

  // the as-scanned line draws in as the chart scrolls into view
  useGSAP(
    () => {
      if (reduce || !line.current) return;
      gsap.fromTo(
        line.current,
        { strokeDasharray: "0 1" },
        { strokeDasharray: "1 0", ease: "none", scrollTrigger: { trigger: line.current, start: "top 85%", end: "top 40%", scrub: true } },
      );
    },
    { scope: root, dependencies: [reduce, sweep] },
  );

  return (
    <div ref={root} className="bg-paper text-ink">
      <div ref={storyEl} className="relative">
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ visibility: live ? "visible" : "hidden" }}>
          <DoorScene story={story} reduce={reduce} live={live} />
        </div>

        <header className="relative z-10 mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-4 px-[var(--gutter)] pt-[var(--gutter)]">
          <Link href="/" aria-label="Rollin’, home" className="shrink-0">
            <Image src="/logo.png" alt="" width={56} height={56} priority className="size-14" />
          </Link>
          {/* an opaque plate: the scene behind it can be the light facade */}
          <nav aria-label="Page" className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-rule bg-paper py-1 pr-1 pl-5 text-base max-lg:border-0 max-lg:bg-transparent max-lg:p-0">
            <a href="#how" className="text-ink-soft hover:text-ink max-lg:hidden">
              How it works
            </a>
            <a href="#numbers" className="text-ink-soft hover:text-ink max-lg:hidden">
              The numbers
            </a>
            <a href="#about" className="text-ink-soft hover:text-ink max-lg:hidden">
              About
            </a>
            <a href="/app" className="border border-rule-strong bg-paper-lift px-4 py-2 font-semibold hover:border-ink">
              Open the app
            </a>
          </nav>
        </header>

        {/* hero */}
        <section className="relative z-10 mx-auto flex min-h-[calc(100svh-5rem)] max-w-[90rem] flex-col justify-center px-[var(--gutter)] pb-16">
          {/* on a narrow screen the scene is behind the text, so the text sits on an opaque plate */}
          <div data-hero-text className="flex max-w-[40rem] flex-col gap-6 max-lg:border max-lg:border-rule-strong max-lg:bg-paper-lift max-lg:p-5">
            <h1 className="flex flex-col gap-3">
              <span className="display text-4xl font-bold">Rollin’</span>
              {" "}
              <span className="max-w-[30rem] text-2xl leading-snug font-semibold">test-drives your wheelchair through an apartment before you visit.</span>
            </h1>
            <p className="max-w-[34rem] text-lg text-ink-soft">
              For wheelchair users looking for a place to rent: see the door that stops your chair, and ask the landlord about the rest.
            </p>
            <div>
              <a href="/app" className="inline-flex min-h-14 items-center bg-ink px-7 text-lg font-semibold text-paper transition-colors transition-draft hover:bg-ink-soft">
                Size your chair
              </a>
            </div>
          </div>
          {HERO_PRESET && (
            <p className="mt-auto max-w-[34rem] pt-10 text-sm text-ink-soft max-lg:mt-10 max-lg:bg-paper-lift max-lg:p-3">
              In the picture: a {HERO_PRESET.width_in.toFixed(1)} × {HERO_PRESET.length_in.toFixed(1)} in manual wheelchair (average user,{" "}
              <a href={HERO_PRESET.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                IDeA Center for the U.S. Access Board
              </a>
              ) at an example 26 in doorway. The doorway is an illustration, not a real unit.
            </p>
          )}
        </section>

        {/* the problem */}
        <Beat beat={1} id="problem">
          <h2 className="display text-3xl font-bold">A listing gives you one checkbox.</h2>
          <div className="flex items-center gap-3 border border-rule-strong bg-paper px-4 py-3" role="img" aria-label="A listing's checkbox, ticked: Wheelchair accessible">
            <svg aria-hidden viewBox="0 0 20 20" className="size-6 shrink-0">
              <rect x="1" y="1" width="18" height="18" fill="none" stroke="var(--ink)" strokeWidth="2" />
              <path d="M5 10.5l3.2 3.2L15 6.5" fill="none" stroke="var(--ink)" strokeWidth="2.2" />
            </svg>
            <span className="text-lg">Wheelchair accessible</span>
          </div>
          <p className="text-lg text-ink-soft">
            It does not say how wide the bathroom door is, or whether your chair can turn in the bedroom. You find out at the viewing, or after you have signed.
          </p>
        </Beat>

        {/* how it works: a real sequence, so the steps are numbered */}
        <div id="how" className="relative z-10 mx-auto max-w-[90rem] scroll-mt-8 px-[var(--gutter)] pt-16">
          <h2 className="display inline-block border border-rule-strong bg-paper-lift px-4 py-2 text-3xl font-bold">How it works</h2>
        </div>
        <Beat beat={2} n={1} title="Measure">
          <p className="text-lg text-ink-soft">
            Set your chair’s width and length, or start from a measured size. Rollin’ tests that footprint, not a generic idea of accessible.
          </p>
        </Beat>
        <Beat beat={3} n={2} title="Test-drive">
          <p className="text-lg text-ink-soft">
            It drives the footprint through each apartment’s scanned floor plan, door by door, and shows the door that stops it and by how much (estimated
            from the scan).
          </p>
        </Beat>
        <Beat beat={4} n={3} title="Ask">
          <p className="text-lg text-ink-soft">
            What the scan cannot settle becomes a question for the leasing office. Rollin’ drafts it, says it is an AI, and sends nothing until you approve.
          </p>
        </Beat>
        <div className="h-[30svh]" />
      </div>

      {/* the numbers: opaque, the scene stops drawing behind them */}
      <section id="numbers" className="relative z-10 border-t border-rule bg-paper">
        <div className="mx-auto flex max-w-[90rem] flex-col gap-8 px-[var(--gutter)] py-24">
          <Numbers sweep={sweep} state={state} lineRef={line} />
        </div>
      </section>

      {/* the way in */}
      <section className="relative z-10 border-t border-rule bg-paper-lift">
        <div className="mx-auto flex max-w-[90rem] flex-col items-start gap-6 px-[var(--gutter)] py-24">
          <h2 className="display text-3xl font-bold">Try it with your chair.</h2>
          <p className="max-w-[40rem] text-lg text-ink-soft">
            Start from a measured size or your own numbers. Rollin’ searches apartments near the Texas Medical Center in Houston and drives your chair
            through each one.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <a href="/app" className="inline-flex min-h-14 items-center bg-ink px-7 text-lg font-semibold text-paper transition-colors transition-draft hover:bg-ink-soft">
              Size your chair
            </a>
            <a href="/app?demo=1" className="inline-flex min-h-14 items-center border border-rule-strong px-6 text-lg font-semibold hover:border-ink">
              Watch the demo run
            </a>
          </div>
        </div>
      </section>

      <About />
    </div>
  );
}

/** one beat of the story: a plate on the left, the scene on the right (below it on a narrow screen) */
function Beat({ beat, id, n, title, children }: { beat: number; id?: string; n?: number; title?: string; children: React.ReactNode }) {
  return (
    <section id={id} data-beat={beat} className="relative z-10 mx-auto flex min-h-[85svh] max-w-[90rem] scroll-mt-8 items-center px-[var(--gutter)] py-16">
      <div className="flex w-full max-w-[32rem] flex-col gap-5 border border-rule-strong bg-paper-lift p-[clamp(1.25rem,3vw,2rem)]">
        {title && (
          <h3 className="flex items-baseline gap-4">
            <span className="measure text-lg text-ink-soft">{n}</span>
            <span className="display text-2xl font-bold">{title}</span>
          </h3>
        )}
        {children}
      </div>
    </section>
  );
}

function Numbers({ sweep, state, lineRef }: { sweep: Sweep | null; state: "loading" | "ready" | "none"; lineRef: React.Ref<SVGPathElement> }) {
  if (!sweep) {
    return (
      <>
        <h2 className="display text-3xl font-bold">The numbers</h2>
        <p className="max-w-[44rem] text-lg text-ink-soft" role="status">
          {state === "loading"
            ? "Loading the batch’s numbers."
            : "The numbers come from our batch, which is not connected to this deployment. Open the app on the demo laptop to see them; nothing is shown here rather than a figure we cannot back."}
        </p>
      </>
    );
  }
  const first = sweep.rows[0];
  const last = sweep.rows.at(-1)!;
  const ref = sweep.reference;
  return (
    <>
      <h2 className="display max-w-[48rem] text-3xl font-bold">
        A wider chair loses apartments fast: {first.fully_reachable} of {sweep.units} at {first.width_in} in wide, {last.fully_reachable} at {last.width_in} in.
      </h2>
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <figure className="flex min-w-0 flex-1 flex-col gap-3">
          <SweepChart sweep={sweep} lineRef={lineRef} />
          <figcaption className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
            <span className="flex items-center gap-2">
              <svg aria-hidden viewBox="0 0 28 8" className="h-2 w-7">
                <line x1="0" x2="28" y1="4" y2="4" stroke="var(--ink)" strokeWidth="3" />
              </svg>
              Fully reachable, as scanned (est.)
            </span>
            <span className="flex items-center gap-2">
              <svg aria-hidden viewBox="0 0 28 8" className="h-2 w-7">
                <line x1="0" x2="28" y1="4" y2="4" stroke="var(--ink-soft)" strokeWidth="2" strokeDasharray="7 5" />
              </svg>
              With offset hinges on every door (est., hinge gain assumed)
            </span>
          </figcaption>
        </figure>
        <div className="flex flex-col gap-6 lg:w-[22rem]">
          {ref && (
            <div className="flex flex-col gap-1 border-l-2 border-ink pl-4">
              <p className="measure text-3xl">
                {ref.unlocked} <span className="text-lg text-ink-soft">est.</span>
              </p>
              <p className="text-base text-ink-soft">
                units that offset hinges unlock for a {ref.chair[0]} × {ref.chair[1]} in chair ({ref.reachable} fully reachable as scanned).
              </p>
            </div>
          )}
        </div>
      </div>
      {/* the summary under the graph, full width: what one point means, and that it is estimated */}
      <p className="max-w-[60rem] text-base text-ink-soft">
        Each point is how many of {sweep.units} apartments near {sweep.area} a chair that wide can reach in every room, estimated from the scans. The dashed
        line adds offset hinges on every door{sweep.generated ? `. Our batch, run ${sweep.generated}.` : "."}
      </p>
    </>
  );
}

function About() {
  return (
    <section id="about" className="relative z-10 border-t border-rule bg-paper">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-10 px-[var(--gutter)] py-24">
        <h2 className="display text-3xl font-bold">About</h2>
        {/* one list, one below another; each part opens on its own */}
        <div className="flex max-w-[48rem] flex-col border-b border-rule-strong">
          <Part title="Measured">Walls, doorways and rooms from each 3D scan. Your chair’s size, or a sourced one.</Part>
          <Part title="Estimated, and labelled">Door clear widths, hinge gains, bathrooms from photos, entrances from aerial images.</Part>
          <Part title="What Rollin’ does not know">Missed doors, steps, thresholds, furniture: questions, sent only when you approve.</Part>
          <Part title="Data">
            <ul className="flex flex-col gap-1">
              <li>Matterport scans and panoramas</li>
              <li>CoStar hackathon models index</li>
              <li>Vexcel aerial imagery</li>
              <li>None of it is republished here</li>
            </ul>
          </Part>
          <Part title="Team">Aayush Deherkar and Aarohi Agrawal</Part>
        </div>
      </div>
    </section>
  );
}

/** one part of About: a native disclosure, so it opens with a click, Enter or Space and is announced as expandable */
function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-rule-strong">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 hover:text-ink-soft [&::-webkit-details-marker]:hidden">
        <h3 className="display text-xl font-bold">{title}</h3>
        <ChevronDown aria-hidden className="size-6 shrink-0 transition-transform duration-[var(--dur-2)] group-open:rotate-180" />
      </summary>
      <div className="pb-5 text-base text-ink-soft">{children}</div>
    </details>
  );
}
