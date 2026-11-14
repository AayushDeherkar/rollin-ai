"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotionConfig } from "motion/react";
import { Ban, Check, CircleHelp } from "lucide-react";
import type { Drive } from "@/lib/chair";
import type { Floor } from "@/lib/contract";
import { M_PER_IN, centroid, type Projection } from "@/lib/plan-geometry";
import { DUR, EASE_DRAFT } from "@/lib/motion";
import { AnimatedFigure } from "./animated-figure";

const BOX_W = 248;
/** first-guess height; the box measures its content and re-places itself */
const BOX_H_GUESS = 236;

type Box = { x: number; y: number; w: number; h: number };
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const around = ([x, y]: [number, number], w: number, h: number): Box => ({ x: x - w / 2, y: y - h / 2, w, h });

/**
 * Drafting callout for where the drive ended: a leader line from the door (or the room)
 * to a ruled box with the figures. Every estimate says "est.". The box goes in the free
 * strip beside the plan if there is one, otherwise wherever it covers the least of the
 * drawing (door figures, room labels, the chair).
 */
export function ChairCallout({
  drive,
  floor,
  chairIn,
  projection,
  size,
  gutter,
  scenario,
}: {
  drive: Drive;
  floor: Floor;
  chairIn: [number, number];
  projection: Projection;
  size: { w: number; h: number };
  /** free strip to the right of the plan, when the plan leaves one */
  gutter: { x: number; w: number } | null;
  scenario: string;
}) {
  const reduce = useReducedMotionConfig();
  const content = useRef<HTMLDivElement>(null);
  const [BOX_H, setBoxH] = useState(BOX_H_GUESS);
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { toScreen, scale } = projection;
  const anchorM = drive.door?.center ?? drive.route[drive.route.length - 1] ?? [0, 0];
  const [ax, ay] = toScreen([anchorM[0], anchorM[1]]);
  const reach = (chairIn[1] * M_PER_IN * scale) / 2 + 28;

  const roomBox = (() => {
    const pts = drive.room.polygon.map((p) => toScreen(p));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  })();
  const obstacles: Box[] = [
    // the room being driven to is the point of the picture: never cover it if avoidable
    roomBox,
    roomBox,
    roomBox,
    ...floor.doors.map((d) => around(toScreen(d.center), 150, 90)),
    ...floor.rooms.map((r) => around(toScreen(centroid(r.polygon)), 130, 80)),
    around(toScreen([drive.route.at(-1)?.[0] ?? anchorM[0], drive.route.at(-1)?.[1] ?? anchorM[1]]), reach * 2, reach * 2),
  ];
  const clamp = (b: Box): Box => ({
    ...b,
    x: Math.min(Math.max(8, b.x), size.w - b.w - 8),
    y: Math.min(Math.max(8, b.y), size.h - b.h - 8),
  });
  const candidates: Box[] = gutter
    ? [{ x: gutter.x + 12, y: ay - 48, w: BOX_W, h: BOX_H }]
    : [
        { x: ax + reach, y: ay - 48, w: BOX_W, h: BOX_H },
        { x: ax - reach - BOX_W, y: ay - 48, w: BOX_W, h: BOX_H },
        { x: ax - BOX_W / 2, y: ay + reach, w: BOX_W, h: BOX_H },
        { x: ax - BOX_W / 2, y: ay - reach - BOX_H, w: BOX_W, h: BOX_H },
        // sheet corners
        { x: 8, y: 8, w: BOX_W, h: BOX_H },
        { x: size.w - BOX_W - 8, y: 8, w: BOX_W, h: BOX_H },
        { x: 8, y: size.h - BOX_H - 8, w: BOX_W, h: BOX_H },
        { x: size.w - BOX_W - 8, y: size.h - BOX_H - 8, w: BOX_W, h: BOX_H },
      ];
  const box = candidates
    .map(clamp)
    .map((b) => ({ b, cost: obstacles.reduce((sum, o) => sum + overlap(b, o), 0) }))
    .sort((p, q) => p.cost - q.cost)[0].b;
  // leader meets the nearest point of the box edge
  const ex = Math.min(Math.max(ax, box.x), box.x + box.w);
  const ey = Math.min(Math.max(ay, box.y), box.y + box.h);

  const hinges = scenario !== "as scanned";

  return (
    <motion.g
      key={drive.room.room_id + drive.kind}
      initial={{ opacity: reduce ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0 : DUR[2], ease: EASE_DRAFT }}
    >
      {/* leader: dot at the door, line to the box */}
      <circle cx={ax} cy={ay} r={4} fill="var(--ink)" />
      <line x1={ax} y1={ay} x2={ex} y2={ey} stroke="var(--ink)" strokeWidth={1.25} />
      <foreignObject x={box.x} y={box.y} width={box.w} height={box.h}>
        <div ref={content} className="flex flex-col gap-2 border-2 border-ink bg-paper-lift px-4 py-3" role="status" aria-live="polite">
          <Body drive={drive} chairIn={chairIn} hinges={hinges} />
        </div>
      </foreignObject>
    </motion.g>
  );
}

/** Bathroom turning space, when the engine measured it (walls only, so optimistic). */
function TurningNote({ drive }: { drive: Drive }) {
  const ts = drive.room.turning_space;
  if (!ts) return null;
  return (
    <p className="text-sm">
      Turning circle <span className="measure font-medium">{ts.max_circle_in.toFixed(1)} in</span>,{" "}
      {ts.meets_60in ? "meets" : "under"} the 60 in needed (walls only).
    </p>
  );
}

function Body({ drive, chairIn, hinges }: { drive: Drive; chairIn: [number, number]; hinges: boolean }) {
  const name = drive.room.label;
  if (drive.kind === "blocked" && drive.door) {
    return (
      <>
        <p className="flex items-center gap-2 text-base leading-tight font-semibold text-block">
          <Ban aria-hidden className="size-5 shrink-0" strokeWidth={2.5} />
          {drive.via ? `${drive.via.label} door stops the chair on the way to the ${name.toLowerCase()}` : `${name} door stops the chair`}
        </p>
        <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2 text-sm">
          <dt>Clear width</dt>
          <dd className="measure text-right font-medium">
            <AnimatedFigure value={drive.door.clear_in_est} /> in
          </dd>
          <dd className="text-ink-soft">est.</dd>
          <dt>Chair width</dt>
          <dd className="measure text-right font-medium">{chairIn[0].toFixed(1)} in</dd>
          <dd />
          <dt className="font-semibold text-block">Short by</dt>
          <dd className="measure text-right font-semibold text-block">
            <AnimatedFigure value={drive.shortfallIn ?? 0} /> in
          </dd>
          <dd className="text-ink-soft">est.</dd>
        </dl>
        <p className="text-sm text-ink-soft">{hinges ? "With offset hinges, gain assumed." : "As scanned."}</p>
        <TurningNote drive={drive} />
      </>
    );
  }
  if (drive.kind === "arrive") {
    return (
      <>
        <p className="flex items-center gap-2 text-base leading-tight font-semibold text-reach">
          <Check aria-hidden className="size-5 shrink-0" strokeWidth={2.5} />
          The chair reaches the {name.toLowerCase()}
        </p>
        {drive.door && drive.spareIn != null && (
          <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2 text-sm">
            <dt>Clear width</dt>
            <dd className="measure text-right font-medium">
              <AnimatedFigure value={drive.door.clear_in_est} /> in
            </dd>
            <dd className="text-ink-soft">est.</dd>
            <dt>Chair width</dt>
            <dd className="measure text-right font-medium">{chairIn[0].toFixed(1)} in</dd>
            <dd />
            <dt className="font-semibold text-reach">Spare</dt>
            <dd className="measure text-right font-semibold text-reach">
              <AnimatedFigure value={drive.spareIn} /> in
            </dd>
            <dd className="text-ink-soft">est.</dd>
          </dl>
        )}
        <p className="text-sm text-ink-soft">
          {drive.enginePath ? "Route found by the engine" : "Marked reachable by the engine"}
          {hinges ? ", with offset hinges (gain assumed)" : ""}.
        </p>
        <TurningNote drive={drive} />
      </>
    );
  }
  if (drive.kind === "tight") {
    return (
      <>
        <p className="flex items-center gap-2 text-base leading-tight font-semibold text-block">
          <Ban aria-hidden className="size-5 shrink-0" strokeWidth={2.5} />
          {name}: route too tight
        </p>
        <p className="text-sm">{drive.room.reason ?? "The engine found no route for the chair."}</p>
      </>
    );
  }
  return (
    <>
      <p className="flex items-center gap-2 text-base leading-tight font-semibold text-unknown">
        <CircleHelp aria-hidden className="size-5 shrink-0" strokeWidth={2.5} />
        {name}: not measured
      </p>
      <p className="text-sm">{drive.room.reason ?? "No door was measured in the scan."} Unknowns become questions for the landlord.</p>
    </>
  );
}
