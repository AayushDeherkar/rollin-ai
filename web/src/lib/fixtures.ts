/**
 * Contract fixtures: synthetic examples only, never real Matterport / CoStar / Vexcel data.
 * The app replays them automatically (and says so on screen) when the API is not reachable.
 */
import asScannedJson from "../../../contracts/unit_result.example.json";
import hingesJson from "../../../contracts/unit_result.hinges.example.json";
import unitsListJson from "../../../contracts/units_list.example.json";
import type { UnitResult, UnitsList } from "./contract";

/** JSON imports widen tuples to number[]; check the shape once, then trust the type. */
function asUnitResult(json: unknown): UnitResult {
  const u = json as UnitResult;
  if (!Array.isArray(u?.chair_in) || u.chair_in.length !== 2 || !Array.isArray(u.floors)) {
    throw new Error("Fixture does not match contracts/unit_result.example.json");
  }
  return u;
}

export const fixtureAsScanned = asUnitResult(asScannedJson);
export const fixtureHinges = asUnitResult(hingesJson);

export const fixtureUnitsList = unitsListJson as unknown as UnitsList;

/** The fixture plan for a sid, if the contract ships one (only the demo unit has a plan). */
export function fixtureUnit(sid: string, hinges: boolean): UnitResult | null {
  if (sid !== fixtureAsScanned.model) return null;
  return hinges ? fixtureHinges : fixtureAsScanned;
}

/** Shown wherever fixture data is on screen, so nobody mistakes it for a real unit. */
export const FIXTURE_LABEL = "Synthetic test unit (contract fixture)";
