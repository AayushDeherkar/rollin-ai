"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, DoorOpen, Image as ImageIcon, Map as MapIcon, Video, X } from "lucide-react";
import type { Drive } from "@/lib/chair";
import type { Room, UnitResult } from "@/lib/contract";
import { fixFor, type Verdict, type VisionItem } from "@/lib/apartment";
import { STATUS, StatusIcon, StatusSwatch } from "@/components/sheet/status";
import { AerialCard } from "@/components/trace/evidence";
import { TourPanel } from "@/components/plan/tour-panel";
import { cn } from "@/lib/utils";

/** The headline verdict, top-left under the step bar. */
export function VerdictLine({ unit, verdict, replay }: { unit: UnitResult; verdict: Verdict; replay: string | null }) {
  return (
    <section aria-label="Verdict" className="pointer-events-auto flex max-w-[640px] flex-col gap-1 border border-rule-strong bg-paper-lift px-5 py-3">
      <p className="text-base text-ink-soft">{unit.name}</p>
      <h1 className="display text-2xl font-bold" aria-live="polite">
        {verdict.text}
      </h1>
      <p className="text-sm text-ink-soft">
        Estimated from the scan{unit.scenario !== "as scanned" ? ", with offset hinges on every door" : ""}.
        {replay !== null && <span title={replay}> Replay with a synthetic apartment.</span>}
      </p>
    </section>
  );
}

/** Every room along the bottom: icon, name and word. Selecting one flies the camera there. */
export function RoomStrip({ rooms, selected, onSelect }: { rooms: Room[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Rooms" className="pointer-events-auto max-w-full min-w-0 overflow-x-auto border border-rule-strong bg-paper-lift">
      <ul className="flex">
        {rooms.map((r) => (
          <li key={r.room_id} className="border-r border-rule last:border-r-0">
            <button
              type="button"
              aria-pressed={selected === r.room_id}
              onClick={() => onSelect(r.room_id)}
              className={cn(
                "flex h-14 items-center gap-2 px-4 text-base font-semibold whitespace-nowrap transition-colors transition-draft",
                selected === r.room_id ? "bg-paper-deep text-ink underline decoration-2 underline-offset-8" : "text-ink-soft hover:bg-paper-deep hover:text-ink",
              )}
            >
              <StatusIcon status={r.status} />
              {r.label}
              <span className="sr-only">: {STATUS[r.status].word}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type EvidenceKind = "tour" | "photo" | "aerial";

/**
 * One room, one card with a fixed shape: status, the reason in one sentence, the fix if any, and
 * the basis, with its evidence one click away.
 */
export function RoomCard({
  room,
  hingesRoom,
  drive,
  chairIn,
  withHinges,
  photo,
  hasTour,
  hasAerial,
  riding,
  onHinges,
  onRide,
  onEvidence,
}: {
  room: Room;
  /** the same room in the hinges result, when there is one */
  hingesRoom: Room | null;
  drive: Drive | null;
  chairIn: [number, number];
  withHinges: boolean;
  photo: VisionItem | null;
  hasTour: boolean;
  hasAerial: boolean;
  riding: boolean;
  onHinges: (on: boolean) => void;
  onRide: () => void;
  onEvidence: (k: EvidenceKind) => void;
}) {
  const fix = fixFor(room, hingesRoom);
  const shown = withHinges && hingesRoom ? hingesRoom : room;
  const S = STATUS[shown.status];
  // a plain sentence from the drive's own figures first; the engine's reason (terse, for developers) only as a fallback
  const reason = (() => {
    if (drive?.room.room_id === room.room_id) {
      if (drive.kind === "arrive" && drive.spareIn != null) return `The chair gets in with ${drive.spareIn.toFixed(1)} in to spare at the widest door (est.).`;
      if (drive.kind === "arrive") return "The chair reaches this room.";
      if (drive.kind === "blocked" && drive.door && drive.shortfallIn != null)
        return `The ${drive.via ? `${drive.via.label.toLowerCase()} ` : ""}door on the way is about ${drive.door.clear_in_est.toFixed(1)} in clear (est.), ${drive.shortfallIn.toFixed(1)} in short for a ${chairIn[0].toFixed(1)} in chair.`;
    }
    if (shown.status === "unknown") return "No door into this room was measured.";
    if (shown.status === "reachable") return "The chair reaches this room.";
    return shown.reason ?? "The chair cannot reach this room.";
  })();
  return (
    <section aria-labelledby="room-title" className="pointer-events-auto flex max-h-[calc(100vh-15rem)] w-[400px] flex-col gap-4 overflow-y-auto border-2 border-ink bg-paper-lift p-5">
      <header className="flex flex-col gap-1">
        <h2 id="room-title" className="display text-2xl font-bold">
          {room.label}
        </h2>
        <p className={cn("flex items-center gap-2 text-base font-semibold", S.text)}>
          <StatusIcon status={shown.status} />
          {S.word}
          {withHinges && hingesRoom && <span className="font-normal text-ink-soft">with offset hinges</span>}
        </p>
      </header>
      <p className="text-base">{reason}</p>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink-soft">Fix</h3>
        {fix.kind === "none" && <p className="text-base">None needed.</p>}
        {fix.kind === "hinges" && (
          <>
            <p className="text-base">Offset (swing-clear) hinges on the door give the chair the room it needs.</p>
            <button
              type="button"
              aria-pressed={withHinges}
              onClick={() => onHinges(!withHinges)}
              className="h-11 self-start bg-ink px-4 text-base font-semibold text-paper transition-colors transition-draft hover:bg-ink-soft"
            >
              {withHinges ? "Show the door as scanned" : "Try offset hinges"}
            </button>
          </>
        )}
        {fix.kind === "landlord-door" && <p className="text-base">Hinges are not enough here. Ask the landlord about a wider doorway.</p>}
        {fix.kind === "landlord-measure" && <p className="text-base">Ask the landlord for this door’s clear width.</p>}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink-soft">Basis</h3>
        <ul className="flex flex-col gap-1.5 text-base">
          <li className="flex items-center gap-2">
            <DoorOpen aria-hidden className="size-5 shrink-0 text-ink-soft" strokeWidth={2} />
            Door widths measured in the scan; clear widths estimated.
          </li>
          {hasTour && (
            <EvidenceLink icon={Video} onClick={() => onEvidence("tour")}>
              See the door in the 3D tour
            </EvidenceLink>
          )}
          {photo && (
            <EvidenceLink icon={Camera} onClick={() => onEvidence("photo")}>
              From a photo: see the panorama
            </EvidenceLink>
          )}
          {hasAerial && (
            <EvidenceLink icon={MapIcon} onClick={() => onEvidence("aerial")}>
              From the aerial: see the building
            </EvidenceLink>
          )}
        </ul>
      </div>
      {shown.status === "reachable" && (
        <button
          type="button"
          aria-pressed={riding}
          onClick={onRide}
          className="h-11 self-start border border-ink px-4 text-base font-semibold transition-colors transition-draft hover:bg-paper-deep"
        >
          {riding ? "Leave the chair" : "Ride along"}
        </button>
      )}
    </section>
  );
}

function EvidenceLink({ icon: Icon, onClick, children }: { icon: typeof ImageIcon; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex items-center gap-2 text-left font-semibold underline underline-offset-4 hover:text-ink-soft">
        <Icon aria-hidden className="size-5 shrink-0" strokeWidth={2} />
        {children}
      </button>
    </li>
  );
}

/** Evidence, opened from the room card: the tour, a panorama or the aerial. Esc closes it. */
export function EvidencePanel({
  kind,
  sid,
  unit,
  door,
  photo,
  onClose,
}: {
  kind: EvidenceKind;
  sid: string;
  unit: UnitResult;
  door: UnitResult["floors"][number]["doors"][number] | null;
  photo: VisionItem | null;
  onClose: () => void;
}) {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    if (kind !== "tour") box.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, onClose]);
  if (kind === "tour") {
    return (
      <div className="pointer-events-auto relative h-[560px] w-[760px]">
        <TourPanel sid={sid} unitName={unit.name} door={door} onClose={onClose} />
      </div>
    );
  }
  return (
    <section ref={box} tabIndex={-1} aria-label={kind === "photo" ? "Panorama" : "Aerial"} className="pointer-events-auto flex w-[640px] flex-col gap-3 border-2 border-ink bg-paper-lift p-4 outline-none">
      <header className="flex items-center justify-between">
        <h2 className="display text-xl font-bold">{kind === "photo" ? `Panorama near the ${photo?.room?.toLowerCase() ?? "room"}` : "The building from the air"}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center hover:bg-paper-deep">
          <X aria-hidden className="size-5" strokeWidth={2.25} />
        </button>
      </header>
      {kind === "photo" && photo && <Panorama sid={sid} item={photo} />}
      {kind === "aerial" && <AerialCard src={`/api/aerial/${sid}`} label="from aerial, estimated" source="Vexcel" />}
    </section>
  );
}

function Panorama({ sid, item }: { sid: string; item: VisionItem }) {
  const [failed, setFailed] = useState(false);
  const answers = Object.entries(item.answers ?? {});
  return (
    <figure className="flex flex-col gap-2">
      {failed ? (
        <p className="py-6 text-base text-ink-soft">This panorama could not be loaded.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a proxied API image, not a static asset
        <img
          src={`/api/vision/${sid}/${encodeURIComponent(item.pano_id)}`}
          alt={`Defurnished panorama near the ${item.room ?? "room"}`}
          onError={() => setFailed(true)}
          className="aspect-[2/1] w-full border border-rule-strong object-cover"
        />
      )}
      <figcaption className="flex flex-col gap-1.5 text-base">
        <span className="text-sm text-ink-soft">{item.label ?? "from a photo, estimated"}</span>
        {answers.map(([key, a]) => (
          <span key={key}>
            <span className="text-ink-soft">{a.question ?? key}</span> <span className="font-semibold">{a.answer ?? "unclear"}</span>
            {a.note && <span className="text-ink-soft">. {a.note}</span>}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** What the model's marks mean, and one-line hints the first time. */
export function ApartmentLegend({ hint }: { hint: string | null }) {
  return (
    <div className="pointer-events-auto flex flex-col gap-2 border border-rule-strong bg-paper-lift px-4 py-3 text-sm">
      <ul aria-label="Legend" className="flex flex-col gap-1.5">
        {(["reachable", "blocked", "unknown"] as const).map((s) => (
          <li key={s} className="flex items-center gap-2">
            <StatusSwatch status={s} />
            {STATUS[s].word}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0">
            <line x1="2" y1="10" x2="18" y2="10" stroke="var(--block)" strokeWidth="3" strokeDasharray="3 2" />
          </svg>
          Dashed sill: the chair does not fit
        </li>
      </ul>
      {hint && <p className="border-t border-rule pt-2 text-ink-soft">{hint}</p>}
    </div>
  );
}
