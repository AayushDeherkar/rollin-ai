import { Landing } from "@/components/landing/landing";

/**
 * The landing page. The guided stage is at /app; `/?demo=1` (presenter mode) is redirected to
 * `/app?demo=1` in next.config.ts, before this page renders, so the pitch still opens directly.
 */
export default function Home() {
  return <Landing />;
}
