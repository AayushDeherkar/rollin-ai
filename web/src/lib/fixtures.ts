/**
 * Contract fixtures. Until Aayush's API (PLAN.md §7.2) is live, the web app reads only
 * these synthetic examples — never real Matterport / CoStar / Vexcel data.
 */
import asScannedJson from "../../../contracts/unit_result.example.json";
import hingesJson from "../../../contracts/unit_result.hinges.example.json";
import type { UnitResult } from "./contract";

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

/** Shown wherever fixture data is on screen, so nobody mistakes it for a real unit. */
export const FIXTURE_LABEL = "Synthetic test unit (contract fixture)";
