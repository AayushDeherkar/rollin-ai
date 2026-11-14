"use client";

/**
 * Step 1 on the table: the chair at full size at the origin, its footprint, the circle it
 * sweeps turning in place (computed from width and length), and the 60 in turning space the
 * engine checks rooms against as a dashed reference ring. Resizes live with the sliders.
 */
import { useMemo, useState } from "react";
import { Line } from "@react-three/drei";
import { ChairBody } from "@/components/dollhouse/dollhouse";
import { M_PER_IN } from "@/lib/plan-geometry";
import { TURNING_IN, sweptIn, type ChairIn } from "@/lib/stage";
import { readPalette } from "@/lib/tokens";

function ring(radius: number, y: number): [number, number, number][] {
  return Array.from({ length: 97 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    return [radius * Math.cos(a), y, radius * Math.sin(a)];
  });
}

export function ChairScene({ chair, visible }: { chair: ChairIn; visible: boolean }) {
  const [palette] = useState(readPalette);
  const swept = useMemo(() => ring((sweptIn(chair) * M_PER_IN) / 2, 0.012), [chair]);
  const turning = useMemo(() => ring((TURNING_IN * M_PER_IN) / 2, 0.01), []);
  return (
    <group visible={visible}>
      {/* turned a little so the camera sees it three-quarter on */}
      <group rotation={[0, -0.45, 0]}>
        <ChairBody chairIn={chair} palette={palette} />
      </group>
      <Line points={swept} color={palette.ink} lineWidth={2} />
      <Line points={turning} color={palette.inkSoft} lineWidth={1.5} dashed dashSize={0.08} gapSize={0.06} />
    </group>
  );
}
