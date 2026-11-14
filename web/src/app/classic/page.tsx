import type { Metadata } from "next";
import { Workbench } from "@/components/workbench";
import { FallbackNotice } from "@/components/fallback-notice";

export const metadata: Metadata = { title: "Rollin' (classic)" };

/**
 * The three-panel layout, unchanged: the fallback when the 3D stage cannot run
 * (no WebGL, a lost context, or a low frame rate), and a plain view for anyone who prefers it.
 */
export default function Classic() {
  return (
    <>
      <Workbench />
      <FallbackNotice />
    </>
  );
}
