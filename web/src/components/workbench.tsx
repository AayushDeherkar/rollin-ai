"use client";

import { useState, useSyncExternalStore } from "react";
import { FIXTURE_LABEL, fixtureAsScanned } from "@/lib/fixtures";
import type { PanelState } from "@/components/sheet/panel";
import { PatternDefs } from "@/components/sheet/status";
import { TitleBlock } from "@/components/sheet/title-block";
import { UnitList, type UnitListItem } from "@/components/panels/unit-list";
import { PlanPanel } from "@/components/panels/plan-panel";
import { TracePanel } from "@/components/panels/trace-panel";

const UNITS: UnitListItem[] = [{ unit: fixtureAsScanned, source: FIXTURE_LABEL }];

type Preview = PanelState | null;

/** `?state=loading` or `?state=empty` previews every panel in that state (for design review). */
function readPreview(): Preview {
  const s = new URLSearchParams(window.location.search).get("state");
  return s === "loading" || s === "empty" ? s : null;
}
const noSubscribe = () => () => {};

function usePreviewState(): Preview {
  return useSyncExternalStore(noSubscribe, readPreview, () => null);
}

export function Workbench() {
  const preview = usePreviewState();
  const [selected, setSelected] = useState<string | null>(null);
  const unit = UNITS.find((u) => u.unit.model === selected)?.unit ?? null;

  const listState: PanelState = preview ?? "ready";
  const planState: PanelState = preview ?? (unit ? "ready" : "empty");
  const traceState: PanelState = preview ?? "empty";
  const [w, l] = (unit ?? fixtureAsScanned).chair_in;

  return (
    <div className="flex h-full flex-col p-3">
      <PatternDefs />
      {/* the sheet: heavy outer frame, hairline inner frame */}
      <main className="flex min-h-0 flex-1 flex-col border-2 border-ink p-1">
        <div className="grid min-h-0 flex-1 grid-cols-[var(--panel-left)_minmax(0,1fr)_var(--panel-right)] border border-rule-strong">
          <UnitList state={listState} items={UNITS} selected={selected} onSelect={setSelected} />
          <div className="flex min-h-0 border-x border-rule-strong">
            <PlanPanel state={planState} title={unit ? unit.name : "Plan"} className="flex-1">
              <div className="flex h-full items-center justify-center p-8 text-base text-ink-soft">
                Floor plan renderer lands in b/plan-svg.
              </div>
            </PlanPanel>
          </div>
          <TracePanel state={traceState} />
        </div>
        <TitleBlock
          cells={[
            { label: "Unit", value: unit ? unit.name : "None selected" },
            { label: "Chair (width × length)", value: `${w.toFixed(1)} × ${l.toFixed(1)} in`, measure: true },
            { label: "Scenario", value: unit ? unit.scenario : "—" },
            { label: "Data", value: unit ? FIXTURE_LABEL : "Contract fixtures only" },
          ]}
        />
      </main>
    </div>
  );
}
