import { Landing } from "@/components/landing/landing";

/**
 * The landing page. The guided stage is at /app. A stage link to the root (`/?demo=1` presenter mode,
 * `/?sid=` from the iMessage bridge, and the stage's other parameters) is redirected to /app with its
 * query in next.config.ts, before this page renders.
 */
export default function Home() {
  return <Landing />;
}
