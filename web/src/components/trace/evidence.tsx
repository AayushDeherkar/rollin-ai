"use client";

/**
 * Evidence the trace shows beside its findings: the aerial image card, what a model saw in an
 * image (vision findings), and the profile a run uses. Every answer keeps its basis and label.
 */
import { useState } from "react";
import Image from "next/image";
import { Check, CircleHelp, ImageOff, X, type LucideIcon } from "lucide-react";
import type { Num, PlanEvent, VisionFinding } from "@/lib/agent-events";
import { BasisChip, NumValue } from "./basis";

const SID = /^[A-Za-z0-9_]{3,40}$/;

/** The image's path on this web app (the API's path, proxied), or null when it is not one we serve. */
export function aerialSrc(sid: string | undefined, imageUrl: string | undefined): string | null {
  if (imageUrl?.startsWith("/api/aerial/")) return imageUrl;
  return sid && SID.test(sid) ? `/api/aerial/${sid}` : null;
}

/** The orthophoto around the building, labelled as what it is: from aerial, estimated. */
export function AerialCard({ src, label, source }: { src: string; label?: string; source?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="flex flex-col gap-1.5 border border-rule-strong bg-paper-deep p-2">
      {failed ? (
        <p className="flex items-center gap-2 py-6 text-sm text-ink-soft">
          <ImageOff aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />
          No aerial image is available for this unit.
        </p>
      ) : (
        <Image
          src={src}
          alt="Aerial photo, straight down, of the unit's building and its surroundings"
          width={480}
          height={480}
          unoptimized
          onError={() => setFailed(true)}
          className="aspect-square h-auto max-h-64 w-full object-cover"
        />
      )}
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
        <BasisChip basis="estimated" />
        <span>{label ?? "from aerial, estimated"}</span>
        {source && <span>Source: {source}</span>}
      </figcaption>
    </figure>
  );
}

const ANSWER: Record<string, { word: string; icon: LucideIcon }> = {
  yes: { word: "Yes", icon: Check },
  no: { word: "No", icon: X },
  unclear: { word: "Unclear", icon: CircleHelp },
};

/** What a model saw in an image: question, answer (word and icon), note, and how we know it. */
export function VisionFindings({ findings }: { findings: VisionFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {findings.map((f, i) => {
        const a = ANSWER[f.answer] ?? ANSWER.unclear;
        const Icon = a.icon;
        return (
          <li key={`${f.item}:${i}`} className="flex flex-col gap-1 text-sm">
            <span className="text-ink-soft">{f.question}</span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex items-center gap-1 font-semibold text-ink">
                <Icon aria-hidden className="size-4" strokeWidth={2.5} />
                {ANSWER[f.answer] ? a.word : `${a.word} (${f.answer})`}
              </span>
              <BasisChip basis={f.basis} />
              {f.label && <span className="text-ink-soft">{f.label}</span>}
            </span>
            {f.note && <span className="text-ink-soft">{f.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The profile the run uses: whether it knows who is asking, and the chair with its basis. */
export function ProfileLine({ profile }: { profile: NonNullable<PlanEvent["profile"]> }) {
  const chair = profile.chair_in?.length === 2 ? (profile.chair_in as [Num, Num]) : null;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-ink-soft">Asked by</span>
      <span>{profile.sender_id ? "a sender id, so the agent can remember them" : "no sender id, so this request stands alone"}</span>
      <span className="text-ink-soft">Chair</span>
      {chair ? (
        <span className="flex flex-wrap items-center gap-x-1.5">
          <NumValue n={chair[0]} />
          <span>×</span>
          <NumValue n={chair[1]} />
        </span>
      ) : (
        <BasisChip basis="unknown" />
      )}
    </div>
  );
}
